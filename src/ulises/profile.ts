import { z } from 'zod';
import { appDb } from '../db';
import { recordEvent } from '../telemetry';
import type { ToolContext } from '../types';
import { eur, type UlisesLimits, type UlisesRule } from './engine';

// The Ulises check: a short questionnaire the customer answers while calm. Their answers become
// limits that Ulises applies to every later proposal. Until they answer, defaults derived from
// their own bank data apply, and the app offers the check. Like a safety rule, a limit can be
// tightened at once but only loosened after a delay, so nobody can talk them out of it mid-call.

export type Movement = { amountCents: number; description: string; createdAt: string };

export type UlisesProfileValues = {
  monthlyIncomeCents: number | null;
  monthlySpendCents: number | null;
  cushionCents: number;
  bigPaymentCents: number;
  // Wait applied to a big payment to someone the customer never paid; 0 = warn only.
  newRecipientHoldMinutes: number;
  // Local hours in Europe/Madrid, [from, to), when payments to other people wait an hour.
  quietHours: { from: number; to: number } | null;
  trustedContact: string | null;
};

export type Detected = {
  monthlyIncomeCents: number | null;
  monthlySpendCents: number | null;
  observedDays: number;
};

export type UlisesProfileView = UlisesProfileValues & {
  source: 'customer' | 'default';
  completedAt: string | null;
  pending: { values: UlisesProfileValues; effectiveAt: string } | null;
  detected: Detected;
  // What the projections and the engine actually use (customer answer, else detected, else default).
  effective: UlisesLimits;
  assumptions: string[];
};

const QUIET_HOLD_MINUTES = 60;
const removalDelayHours = () => Number(process.env.ULISES_RULE_REMOVAL_DELAY_HOURS || 24);
const SALARY = /(salary|salario|nomina|nómina|payroll|sueldo|pension|pensión)/i;
const NOT_SPENDING = /(opening|apertura|savings|ahorro)/i;
const roundTo = (cents: number, step: number) => Math.round(cents / step) * step;

// Income and spending read from the bank ledger. Only the last 30 days of activity count, ending
// at the latest movement, so a quiet month does not stretch the estimate.
export function detectMonthly(movements: Movement[]): Detected {
  const dated = movements.filter((m) => !NOT_SPENDING.test(m.description));
  if (!dated.length) return { monthlyIncomeCents: null, monthlySpendCents: null, observedDays: 0 };
  const latest = Math.max(...dated.map((m) => Date.parse(m.createdAt)));
  const since = latest - 30 * 86_400_000;
  const recent = dated.filter((m) => Date.parse(m.createdAt) > since);
  const salary = movements
    .filter((m) => m.amountCents > 0 && SALARY.test(m.description))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const spend = recent.filter((m) => m.amountCents < 0).reduce((a, m) => a - m.amountCents, 0);
  const earliest = Math.min(...recent.map((m) => Date.parse(m.createdAt)));
  return {
    monthlyIncomeCents: salary?.amountCents ?? null,
    monthlySpendCents: spend || null,
    observedDays: Math.max(1, Math.round((latest - earliest) / 86_400_000)),
  };
}

export function defaultValues(d: Detected): UlisesProfileValues {
  return {
    monthlyIncomeCents: null,
    monthlySpendCents: null,
    // Half a month's income, never less than 300 EUR.
    cushionCents: Math.max(30000, roundTo((d.monthlyIncomeCents ?? 0) / 2, 5000)),
    bigPaymentCents: 50000,
    newRecipientHoldMinutes: 0,
    quietHours: null,
    trustedContact: null,
  };
}

// Limits the engine and projections use, with the assumptions spelled out for the customer.
export function effectiveLimits(
  v: UlisesProfileValues,
  source: 'customer' | 'default',
  d: Detected,
): { limits: UlisesLimits; assumptions: string[] } {
  const assumptions: string[] = [];
  const income = v.monthlyIncomeCents ?? d.monthlyIncomeCents;
  if (v.monthlyIncomeCents === null)
    assumptions.push(
      income
        ? `Monthly income ${eur(income)}, read from your latest salary payment.`
        : 'No regular income found in your recent activity.',
    );
  let spend = v.monthlySpendCents;
  if (spend === null) {
    // A month of card data rarely shows rent or bills paid elsewhere, so the estimate is never
    // allowed below half the income.
    spend = Math.max(d.monthlySpendCents ?? 0, Math.round((income ?? 0) / 2)) || null;
    if (spend)
      assumptions.push(
        `Monthly spending ${eur(spend)}: ${
          spend === d.monthlySpendCents
            ? `from your last ${d.observedDays} days of activity`
            : 'assumed as half your income, because your recent activity shows less'
        }. Tell Ulises your real figure for a sharper picture.`,
      );
  }
  if (source === 'default')
    assumptions.push(
      `Default safety cushion ${eur(v.cushionCents)}; you have not set your own limits yet.`,
    );
  return {
    limits: {
      source,
      cushionCents: v.cushionCents,
      bigPaymentCents: v.bigPaymentCents,
      monthlyIncomeCents: income,
      monthlySpendCents: spend,
    },
    assumptions,
  };
}

// The limits that hold or flag a payment, written as rules so the engine, the panel and the
// assistant treat them exactly like the safety rules the customer dictates in the chat.
export function profileRules(v: UlisesProfileValues): UlisesRule[] {
  const rules: UlisesRule[] = [];
  if (v.newRecipientHoldMinutes > 0)
    rules.push({
      id: 'profile:new-recipient',
      label: `From my Ulises check: if I send ${eur(v.bigPaymentCents)} or more to someone I have never paid, make me wait ${duration(v.newRecipientHoldMinutes)}.`,
      when: {
        minAmountCents: v.bigPaymentCents,
        onlyNewRecipients: true,
        hoursFrom: null,
        hoursTo: null,
      },
      holdMinutes: v.newRecipientHoldMinutes,
      trustedContact: v.trustedContact,
    });
  if (v.quietHours)
    rules.push({
      id: 'profile:quiet-hours',
      label: `From my Ulises check: between ${hh(v.quietHours.from)} and ${hh(v.quietHours.to)}, make me wait ${duration(QUIET_HOLD_MINUTES)} before paying anyone.`,
      when: {
        minAmountCents: null,
        onlyNewRecipients: false,
        hoursFrom: v.quietHours.from,
        hoursTo: v.quietHours.to,
      },
      holdMinutes: QUIET_HOLD_MINUTES,
      trustedContact: v.trustedContact,
    });
  return rules;
}

const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;
export const duration = (minutes: number) =>
  minutes % 1440 === 0
    ? `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`
    : minutes % 60 === 0
      ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
      : `${minutes} minutes`;

const quietCovers = (a: UlisesProfileValues['quietHours'], b: UlisesProfileValues['quietHours']) =>
  !a || (!!b && b.from === a.from && b.to === a.to);

// Does `next` protect less than `current` anywhere? Income and spending are facts, not protection.
export function loosens(current: UlisesProfileValues, next: UlisesProfileValues) {
  return (
    next.cushionCents < current.cushionCents ||
    next.bigPaymentCents > current.bigPaymentCents ||
    next.newRecipientHoldMinutes < current.newRecipientHoldMinutes ||
    !quietCovers(current.quietHours, next.quietHours) ||
    (!!current.trustedContact && !next.trustedContact)
  );
}

export const profileInputSchema = z
  .object({
    monthlyIncomeCents: z.number().int().positive().max(100_000_000).nullable(),
    monthlySpendCents: z.number().int().positive().max(100_000_000).nullable(),
    cushionCents: z.number().int().min(0).max(100_000_000),
    bigPaymentCents: z.number().int().min(1000).max(100_000_000),
    newRecipientHoldMinutes: z.number().int().min(0).max(4320),
    quietHours: z
      .object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(24) })
      .strict()
      .refine((q) => q.from !== q.to, 'Quiet hours need a start and an end.')
      .nullable(),
    trustedContact: z.string().trim().max(80).nullable(),
  })
  .strict();

// ---------- Storage ----------

// One row per customer: the saved limits (data) and, while the check is in progress, its draft.
// A row holding only a draft is not a profile yet.
type Row = {
  user_id: string;
  data: string;
  completed_at: string;
  pending: string | null;
  pending_effective_at: string | null;
};

function storedRow(userId: string, now: Date) {
  const db = appDb();
  let row = db
    .prepare('SELECT * FROM ulises_profiles WHERE user_id=? AND data IS NOT NULL')
    .get(userId) as Row | undefined;
  // A pending loosening becomes the profile once its delay has passed.
  if (row?.pending && row.pending_effective_at && row.pending_effective_at <= now.toISOString()) {
    db.prepare(
      'UPDATE ulises_profiles SET data=?,completed_at=?,pending=NULL,pending_effective_at=NULL WHERE user_id=?',
    ).run(row.pending, row.pending_effective_at, userId);
    row = db
      .prepare('SELECT * FROM ulises_profiles WHERE user_id=? AND data IS NOT NULL')
      .get(userId) as Row;
  }
  return row;
}

export function buildView(row: Row | undefined, detected: Detected): UlisesProfileView {
  const source = row ? 'customer' : 'default';
  const values: UlisesProfileValues = row ? JSON.parse(row.data) : defaultValues(detected);
  const { limits, assumptions } = effectiveLimits(values, source, detected);
  return {
    ...values,
    source,
    completedAt: row?.completed_at ?? null,
    pending:
      row?.pending && row.pending_effective_at
        ? { values: JSON.parse(row.pending), effectiveAt: row.pending_effective_at }
        : null,
    detected,
    effective: limits,
    assumptions,
  };
}

export function profileView(userId: string, movements: Movement[], now = new Date()) {
  return buildView(storedRow(userId, now), detectMonthly(movements));
}

export function saveProfile(
  ctx: ToolContext,
  args: unknown,
  movements: Movement[],
  now = new Date(),
) {
  const next = profileInputSchema.parse(args);
  clearCheckDraft(ctx.userId);
  const db = appDb(),
    row = storedRow(ctx.userId, now),
    at = now.toISOString();
  const current: UlisesProfileValues | null = row ? JSON.parse(row.data) : null;
  if (current && loosens(current, next)) {
    const effectiveAt = new Date(now.getTime() + removalDelayHours() * 3_600_000).toISOString();
    db.prepare('UPDATE ulises_profiles SET pending=?,pending_effective_at=? WHERE user_id=?').run(
      JSON.stringify(next),
      effectiveAt,
      ctx.userId,
    );
    recordEvent(ctx, 'ulises.profile_saved', { status: 'pending', effectiveAt, values: next });
    return {
      status: 'pending',
      effectiveAt,
      profile: profileView(ctx.userId, movements, now),
      message: `Some of these limits protect you less than the ones you have now, so they take effect in ${removalDelayHours()} hours. Until then your current limits stay in place. This delay protects you if someone is pressuring you right now.`,
    };
  }
  db.prepare(
    `INSERT INTO ulises_profiles(user_id,data,completed_at) VALUES(?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,completed_at=excluded.completed_at,pending=NULL,pending_effective_at=NULL`,
  ).run(ctx.userId, JSON.stringify(next), at);
  recordEvent(ctx, 'ulises.profile_saved', { status: 'active', values: next });
  return {
    status: 'active',
    profile: profileView(ctx.userId, movements, now),
    message: 'Your Ulises limits are saved. They apply from now on to every new transfer proposal.',
  };
}

// ---------- The check in progress ----------
// Every answer is saved as it is given, like a chat message, so closing the window, reloading or
// switching device never loses the conversation. The draft is removed once the limits are saved.

const DRAFT_TTL_MS = 30 * 86_400_000;
export const checkDraftSchema = z
  .object({
    values: profileInputSchema,
    answers: z.array(z.string().max(200)).max(20),
    asked: z.array(z.string().max(600)).max(20),
    // The side conversation inside a question: what the customer asked and Ulises' replies.
    notes: z
      .array(
        z
          .object({
            at: z.number().int().min(0).max(20),
            from: z.enum(['me', 'ulises']),
            text: z.string().max(1200),
          })
          .strict(),
      )
      .max(60)
      .optional(),
  })
  .strict()
  .refine((d) => d.answers.length === d.asked.length, 'Each answer needs its question.');
export type CheckDraft = z.infer<typeof checkDraftSchema> & { updatedAt: string };

export function checkDraft(userId: string, now = new Date()): CheckDraft | null {
  const row = appDb()
    .prepare(
      'SELECT draft AS data,draft_updated_at AS updated_at FROM ulises_profiles WHERE user_id=? AND draft IS NOT NULL',
    )
    .get(userId) as { data: string; updated_at: string } | undefined;
  if (!row || now.getTime() - Date.parse(row.updated_at) > DRAFT_TTL_MS) return null;
  return { ...JSON.parse(row.data), updatedAt: row.updated_at };
}

export function saveCheckDraft(userId: string, args: unknown, now = new Date()) {
  const draft = checkDraftSchema.parse(args);
  if (!draft.answers.length) return clearCheckDraft(userId);
  appDb()
    .prepare(
      `INSERT INTO ulises_profiles(user_id,draft,draft_updated_at) VALUES(?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET draft=excluded.draft,draft_updated_at=excluded.draft_updated_at`,
    )
    .run(userId, JSON.stringify(draft), now.toISOString());
  return { status: 'saved', updatedAt: now.toISOString() };
}

export function clearCheckDraft(userId: string) {
  const db = appDb();
  db.prepare('UPDATE ulises_profiles SET draft=NULL,draft_updated_at=NULL WHERE user_id=?').run(
    userId,
  );
  db.prepare('DELETE FROM ulises_profiles WHERE user_id=? AND data IS NULL').run(userId);
  return { status: 'cleared', updatedAt: null };
}
