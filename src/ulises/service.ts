import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { appDb } from '../db';
import { HttpError } from '../auth';
import { bankRequest } from '../banking/client';
import { recordEvent } from '../telemetry';
import type { ToolContext, TransferInput } from '../types';
import type { TransferParties } from '../banking/authorization';
import { assess, madridDateTime, type UlisesAssessment, type UlisesRule } from './engine';
import { profileRules, profileView } from './profile';

// Wiring between the pure engine and the application: it gathers facts from the bank and the
// application records, stores each assessment next to its proposal, and enforces the friction on
// the confirmation endpoint. The bank is never asked to do anything new.

const scamHoldMinutes = () => Number(process.env.ULISES_SCAM_HOLD_MINUTES || 30);
const removalDelayHours = () => Number(process.env.ULISES_RULE_REMOVAL_DELAY_HOURS || 24);

type RuleRow = {
  id: string;
  user_id: string;
  label: string;
  when_json: string;
  hold_minutes: number;
  trusted_contact: string | null;
  created_at: string;
  removal_requested_at: string | null;
  removal_effective_at: string | null;
};
type AssessmentRow = {
  approval_id: string;
  intent_id: string;
  user_id: string;
  conversation_id: string | null;
  data: string;
  hold_until: string | null;
  requires_ack: number;
  acknowledged_at: string | null;
  incident_id: string | null;
  created_at: string;
};
type Movement = { amountCents: number; description: string; createdAt: string };

const toRule = (
  r: RuleRow,
): UlisesRule & { createdAt: string; removalEffectiveAt: string | null } => ({
  id: r.id,
  label: r.label,
  when: JSON.parse(r.when_json),
  holdMinutes: r.hold_minutes,
  trustedContact: r.trusted_contact,
  createdAt: r.created_at,
  removalEffectiveAt: r.removal_effective_at,
});

// ---------- Rules: the customer's "Ulysses contract", written while calm ----------

export function listRules(userId: string, now = new Date()) {
  return (
    appDb()
      .prepare(
        'SELECT * FROM ulises_rules WHERE user_id=? AND (removal_effective_at IS NULL OR removal_effective_at>?) ORDER BY created_at',
      )
      .all(userId, now.toISOString()) as RuleRow[]
  ).map(toRule);
}

export const ruleInputSchema = z
  .object({
    label: z.string().trim().min(5).max(240),
    minAmountCents: z.number().int().positive().max(10000000).nullable(),
    onlyNewRecipients: z.boolean(),
    hoursFrom: z.number().int().min(0).max(23).nullable(),
    hoursTo: z.number().int().min(0).max(24).nullable(),
    holdMinutes: z.number().int().min(1).max(4320),
    trustedContact: z.string().trim().max(80).nullable(),
  })
  .strict()
  .refine((r) => (r.hoursFrom === null) === (r.hoursTo === null), 'Give both hours or neither.');

export function createRule(ctx: ToolContext, args: unknown) {
  const input = ruleInputSchema.parse(args);
  const active = listRules(ctx.userId);
  if (active.length >= 10) throw new HttpError(409, 'A customer can keep at most 10 safety rules.');
  const id = randomUUID(),
    now = new Date().toISOString();
  const when = {
    minAmountCents: input.minAmountCents,
    onlyNewRecipients: input.onlyNewRecipients,
    hoursFrom: input.hoursFrom,
    hoursTo: input.hoursTo,
  };
  appDb()
    .prepare('INSERT INTO ulises_rules VALUES(?,?,?,?,?,?,?,?,?)')
    .run(
      id,
      ctx.userId,
      input.label,
      JSON.stringify(when),
      input.holdMinutes,
      input.trustedContact,
      now,
      null,
      null,
    );
  recordEvent(ctx, 'ulises.rule_created', { status: 'active', ruleId: id, label: input.label });
  return {
    status: 'active',
    rule: toRule(appDb().prepare('SELECT * FROM ulises_rules WHERE id=?').get(id) as RuleRow),
    message: 'Safety rule saved. It applies from now on to every new transfer proposal.',
  };
}

// Ulysses cannot untie himself mid-storm: removing a rule only takes effect after a delay, so a
// scammer coaching the customer on the phone cannot get the protection switched off on the spot.
export function requestRuleRemoval(ctx: ToolContext, ruleId: string) {
  const db = appDb();
  const row = db
    .prepare('SELECT * FROM ulises_rules WHERE id=? AND user_id=?')
    .get(ruleId, ctx.userId) as RuleRow | undefined;
  if (!row) throw new HttpError(404, 'Safety rule not found.');
  if (row.removal_effective_at)
    return {
      status: 'removal_pending',
      removalEffectiveAt: row.removal_effective_at,
      message: 'Removal was already requested; the rule stays active until then.',
    };
  const now = new Date(),
    effective = new Date(now.getTime() + removalDelayHours() * 3_600_000).toISOString();
  db.prepare(
    'UPDATE ulises_rules SET removal_requested_at=?,removal_effective_at=? WHERE id=?',
  ).run(now.toISOString(), effective, ruleId);
  recordEvent(ctx, 'ulises.rule_removal_requested', {
    status: 'removal_pending',
    ruleId,
    effective,
  });
  return {
    status: 'removal_pending',
    removalEffectiveAt: effective,
    message: `The rule stays active for ${removalDelayHours()} hours and is removed after that. This delay protects the customer if someone is pressuring them right now.`,
  };
}

// ---------- Assessment of a transfer proposal ----------

export async function assessProposal(
  ctx: ToolContext,
  input: TransferInput,
  parties: TransferParties,
): Promise<UlisesAssessment & { notes: string[] }> {
  const db = appDb(),
    now = new Date(),
    notes: string[] = [];
  let recentOutgoingCents: number[] = [],
    movements: Movement[] = [];
  try {
    movements = await bankRequest<Movement[]>(ctx.userId, '/v1/movements');
    recentOutgoingCents = movements
      .filter((m) => m.amountCents < 0)
      .slice(0, 30)
      .map((m) => -m.amountCents);
  } catch {
    // Without history the unusual-amount signal is skipped, never guessed.
    notes.push(
      'Recent movements could not be read from the bank; the unusual-amount check was skipped.',
    );
  }
  const knownRecipientIds = (
    db
      .prepare("SELECT payload FROM intents WHERE user_id=? AND status='completed'")
      .all(ctx.userId) as {
      payload: string;
    }[]
  ).map((r) => (JSON.parse(r.payload) as TransferInput).toAccountId);
  const since = new Date(now.getTime() - 30 * 60_000).toISOString();
  const proposalsLast30Min = (
    db
      .prepare('SELECT COUNT(*) n FROM intents WHERE user_id=? AND created_at>?')
      .get(ctx.userId, since) as { n: number }
  ).n;
  const customerText = ctx.conversationId
    ? (
        db
          .prepare(
            "SELECT content FROM messages WHERE conversation_id=? AND role='user' ORDER BY created_at DESC,rowid DESC LIMIT 12",
          )
          .all(ctx.conversationId) as { content: string }[]
      )
        .map((m) => m.content)
        .join('\n')
    : '';
  const profile = profileView(ctx.userId, movements, now);
  if (profile.source === 'default')
    notes.push('The customer has not done the Ulises check yet; default limits were used.');
  const result = assess(
    {
      amountCents: input.amountCents,
      concept: input.concept,
      toAccountId: input.toAccountId,
      ownAccount: parties.to.name === 'Your own account',
      fromBalanceCents: parties.from.balanceCents,
      recentOutgoingCents,
      knownRecipientIds,
      proposalsLast30Min,
      customerText,
      now,
    },
    [
      ...listRules(ctx.userId, now),
      ...(profile.source === 'customer' ? profileRules(profile) : []),
    ],
    scamHoldMinutes(),
    profile.effective,
  );
  return { ...result, notes };
}

export function saveAssessment(
  ctx: ToolContext,
  approvalId: string,
  intentStorageId: string,
  assessment: UlisesAssessment & { notes: string[] },
) {
  const db = appDb(),
    now = new Date().toISOString();
  let incidentId: string | null = null;
  // A likely scam is also put in front of a person: operators see it in their queue with the reasons.
  if (assessment.level === 'scam' && ctx.conversationId) {
    const existing = db
      .prepare('SELECT id FROM incidents WHERE conversation_id=? AND status=?')
      .get(ctx.conversationId, 'open') as { id: string } | undefined;
    incidentId = existing?.id || randomUUID();
    if (!existing)
      db.prepare('INSERT INTO incidents VALUES(?,?,?,?,?,?)').run(
        incidentId,
        ctx.userId,
        ctx.conversationId,
        `Ulises scam shield: transfer held for review. Signals: ${assessment.signals.map((s) => s.label).join(', ')}.`,
        'open',
        now,
      );
  }
  db.prepare('INSERT OR REPLACE INTO ulises_assessments VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    approvalId,
    intentStorageId,
    ctx.userId,
    ctx.conversationId,
    JSON.stringify(assessment),
    assessment.friction.holdUntil,
    assessment.friction.requiresAcknowledgement ? 1 : 0,
    null,
    incidentId,
    now,
  );
  recordEvent(ctx, 'ulises.assessed', {
    status: assessment.level,
    score: assessment.score,
    signals: assessment.signals,
    friction: assessment.friction.mode,
    holdUntil: assessment.friction.holdUntil,
    rules: assessment.friction.matchedRules.map((r) => r.id),
    incidentId,
  });
  return incidentId;
}

export type PublicAssessment = UlisesAssessment & {
  notes: string[];
  acknowledgedAt: string | null;
  incidentId: string | null;
};

const publicView = (row: AssessmentRow): PublicAssessment => ({
  ...(JSON.parse(row.data) as UlisesAssessment & { notes: string[] }),
  acknowledgedAt: row.acknowledged_at,
  incidentId: row.incident_id,
});

export function assessmentForApproval(approvalId: string): PublicAssessment | null {
  const row = appDb()
    .prepare('SELECT * FROM ulises_assessments WHERE approval_id=?')
    .get(approvalId) as AssessmentRow | undefined;
  return row ? publicView(row) : null;
}

export function assessmentForIntent(intentStorageId: string): PublicAssessment | null {
  const row = appDb()
    .prepare('SELECT * FROM ulises_assessments WHERE intent_id=? ORDER BY created_at DESC LIMIT 1')
    .get(intentStorageId) as AssessmentRow | undefined;
  return row ? publicView(row) : null;
}

// Called by the confirmation endpoint before the proposal is consumed. Friction is enforced here,
// on the server, so it cannot be skipped by calling the API directly.
export function enforceBeforeConfirm(
  userId: string,
  approvalId: string,
  acknowledged: boolean,
  now = new Date(),
) {
  const db = appDb();
  const row = db
    .prepare('SELECT * FROM ulises_assessments WHERE approval_id=? AND user_id=?')
    .get(approvalId, userId) as AssessmentRow | undefined;
  if (!row) return;
  if (row.hold_until && row.hold_until > now.toISOString())
    throw new HttpError(
      423,
      `Ulises is holding this transfer until ${madridDateTime(row.hold_until)} (Madrid time) because of ${
        JSON.parse(row.data).level === 'scam' ? 'signs of a scam' : 'a safety rule you set yourself'
      }. Nothing has been sent.`,
    );
  if (row.requires_ack && !row.acknowledged_at) {
    if (!acknowledged)
      throw new HttpError(
        428,
        'Read the Ulises warning on the proposal and confirm that you reviewed it before sending.',
      );
    db.prepare('UPDATE ulises_assessments SET acknowledged_at=? WHERE approval_id=?').run(
      now.toISOString(),
      approvalId,
    );
  }
}
