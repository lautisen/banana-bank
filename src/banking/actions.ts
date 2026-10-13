import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { appDb } from '../db';
import { HttpError } from '../auth';
import { person } from '../people';
import { authorizeTransfer } from './authorization';
import { dispatchTransfer, verifyTransfer, type DispatchOutcome } from './dispatch';
import { recordEvent } from '../telemetry';
import {
  assessProposal,
  assessmentForApproval,
  enforceBeforeConfirm,
  saveAssessment,
} from '../ulises/service';
import type { ActionResult, Operation, ToolContext, TransferInput } from '../types';

export const transferSchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amountCents: z.number().int().positive().max(10000000),
    concept: z.string().max(200),
  })
  .strict();
export const approvalTtlMs = 10 * 60 * 1000;
// A dispatch (3 attempts plus verification) ends within seconds. An intent still "submitting" well
// after its confirmation was interrupted (for example by a restart), so it is verified by reference.
export const submitTimeoutMs = 60 * 1000;

// Intent lifecycle:
//   awaiting_confirmation -> submitting -> completed | rejected | not_executed | pending_verification
//   awaiting_confirmation -> cancelled
//   pending_verification  -> completed | not_executed   (by looking the fixed reference up)
//   submitting (older than submitTimeoutMs) -> completed | not_executed | pending_verification
// "failed" only exists in records created before this lifecycle; it is treated as unverified.
export type IntentRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  run_id: string | null;
  payload: string;
  status: string;
  bank_reference: string | null;
  operation_id: string | null;
  error: string | null;
  created_at: string;
};
type ApprovalRow = {
  id: string;
  user_id: string;
  intent_id: string;
  payload: string;
  expires_at: string;
  consumed_at: string | null;
};

// Intent ids supplied by clients are scoped to the customer, so one customer's id can neither
// collide with nor reveal another customer's intent.
const storageId = (userId: string, intentId: string) => `${userId}:${intentId}`;
const publicId = (row: IntentRow) =>
  row.id.startsWith(`${row.user_id}:`) ? row.id.slice(row.user_id.length + 1) : row.id;
const euros = (cents: number) => `${(cents / 100).toFixed(2)} EUR`;

function findIntent(userId: string, id: string) {
  return appDb()
    .prepare('SELECT * FROM intents WHERE user_id=? AND id IN (?,?)')
    .get(userId, storageId(userId, id), id) as IntentRow | undefined;
}
function intentById(id: string) {
  return appDb().prepare('SELECT * FROM intents WHERE id=?').get(id) as IntentRow;
}
function pendingApproval(intentId: string) {
  return appDb()
    .prepare('SELECT * FROM approvals WHERE intent_id=? ORDER BY expires_at DESC LIMIT 1')
    .get(intentId) as ApprovalRow | undefined;
}
function ctxFor(row: IntentRow, runId = randomUUID()): ToolContext {
  return {
    userId: row.user_id,
    conversationId: row.conversation_id,
    runId,
    intentId: publicId(row),
  };
}

export function describeIntent(row: IntentRow, operation?: Operation | null): ActionResult {
  const payload = JSON.parse(row.payload) as TransferInput;
  const base = { intentId: publicId(row), reference: row.bank_reference, payload };
  switch (row.status) {
    case 'awaiting_confirmation': {
      const approval = pendingApproval(row.id);
      if (!approval || approval.expires_at <= new Date().toISOString())
        return {
          status: 'expired',
          ...base,
          message: 'This proposal expired without being confirmed. No money moved.',
        };
      return {
        status: 'requires_confirmation',
        ...base,
        approval: { id: approval.id, payload, expiresAt: approval.expires_at },
        ulises: assessmentForApproval(approval.id),
        message: 'Waiting for the account holder to review and confirm the proposal.',
      };
    }
    case 'submitting':
      return { status: 'processing', ...base, message: 'The confirmed transfer is being sent.' };
    case 'completed':
      return {
        status: 'completed',
        ...base,
        operationId: row.operation_id,
        ...(operation ? { operation } : {}),
        message: `The bank completed the transfer of ${euros(payload.amountCents)}.`,
      };
    case 'rejected':
      return {
        status: 'rejected',
        ...base,
        error: row.error,
        message: 'The bank rejected the transfer. No money moved.',
      };
    case 'not_executed':
      return {
        status: 'not_executed',
        ...base,
        error: row.error,
        message:
          'The bank has no record of this transfer, so no money moved. Sending it now needs a new proposal and confirmation.',
      };
    case 'pending_verification':
      return {
        status: 'pending_verification',
        ...base,
        error: row.error,
        message:
          'The bank did not answer, so it is not yet known whether the transfer was executed. Do not repeat it; check its status later.',
      };
    case 'cancelled':
      return {
        status: 'cancelled',
        ...base,
        message: 'The proposal was cancelled. No money moved.',
      };
    default:
      return {
        status: 'unverified',
        ...base,
        error: row.error,
        message: 'This record predates verification. Check its status against the bank.',
      };
  }
}

// Customer intent -> proposal. Nothing is sent to the bank here: the holder must review the
// amount, source, destination and description and confirm them through the application.
export async function transferMoney(ctx: ToolContext, args: unknown): Promise<ActionResult> {
  if (person(ctx.userId)?.role !== 'customer')
    throw new HttpError(403, 'A customer account is required.');
  const input = transferSchema.parse(args),
    payload = JSON.stringify(input),
    db = appDb();
  const existing = findIntent(ctx.userId, ctx.intentId);
  if (existing) {
    if (existing.payload !== payload)
      throw new HttpError(409, 'This intent already exists with different details.');
    return describeIntent(existing);
  }
  if (ctx.dedupeProposals && ctx.conversationId) {
    const open = db
      .prepare(
        `SELECT i.* FROM intents i JOIN approvals a ON a.intent_id=i.id
         WHERE i.user_id=? AND i.conversation_id=? AND i.status='awaiting_confirmation'
           AND i.payload=? AND a.consumed_at IS NULL AND a.expires_at>? LIMIT 1`,
      )
      .get(ctx.userId, ctx.conversationId, payload, new Date().toISOString()) as
      IntentRow | undefined;
    if (open) return describeIntent(open);
  }
  const permission = await authorizeTransfer(ctx.userId, input);
  if (!permission.ok) {
    recordEvent(ctx, 'transfer.rejected', { status: 'rejected', input, error: permission.error });
    return {
      status: 'rejected',
      code: permission.code,
      error: permission.error,
      intentId: ctx.intentId,
    };
  }
  // Ulises checks the pressure around this payment before anything is stored or shown.
  const ulises = await assessProposal(ctx, input, permission.parties);
  const id = storageId(ctx.userId, ctx.intentId),
    now = new Date(),
    approvalId = randomUUID(),
    reference = `bb-${randomUUID()}`,
    // A held proposal stays reviewable for the usual window after its hold ends; otherwise it
    // would expire while held and the customer could never confirm it.
    expiresAt = new Date(
      Math.max(now.getTime(), Date.parse(ulises.friction.holdUntil ?? '') || 0) + approvalTtlMs,
    ).toISOString();
  const created = db.transaction(() => {
    const raced = findIntent(ctx.userId, ctx.intentId);
    if (raced) return raced;
    db.prepare('INSERT INTO intents VALUES(?,?,?,?,?,?,?,?,?,?)').run(
      id,
      ctx.userId,
      ctx.conversationId,
      ctx.runId,
      payload,
      'awaiting_confirmation',
      reference,
      null,
      null,
      now.toISOString(),
    );
    db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?,?)').run(
      approvalId,
      ctx.userId,
      id,
      payload,
      expiresAt,
      null,
    );
    saveAssessment(ctx, approvalId, id, ulises);
    return null;
  })();
  if (created) {
    if (created.payload !== payload)
      throw new HttpError(409, 'This intent already exists with different details.');
    return describeIntent(created);
  }
  recordEvent(ctx, 'transfer.proposed', { status: 'requires_confirmation', input, reference });
  return {
    status: 'requires_confirmation',
    intentId: ctx.intentId,
    reference,
    approval: { id: approvalId, payload: input, summary: permission.parties, expiresAt },
    ulises: assessmentForApproval(approvalId),
    message:
      'Proposal created. The customer must review and confirm it in the application; it has not been sent to the bank.',
  };
}

function applyOutcome(row: IntentRow, outcome: DispatchOutcome, ctx: ToolContext) {
  const db = appDb();
  if (outcome.kind === 'completed') {
    db.prepare('UPDATE intents SET status=?,operation_id=?,error=NULL WHERE id=?').run(
      'completed',
      outcome.operation.id,
      row.id,
    );
    recordEvent(ctx, 'transfer.completed', {
      status: 'completed',
      reference: row.bank_reference,
      operation: outcome.operation,
    });
    return describeIntent(intentById(row.id), outcome.operation);
  }
  const status =
    outcome.kind === 'rejected'
      ? 'rejected'
      : outcome.kind === 'not_executed'
        ? 'not_executed'
        : 'pending_verification';
  db.prepare('UPDATE intents SET status=?,error=? WHERE id=?').run(status, outcome.error, row.id);
  recordEvent(ctx, `transfer.${status}`, {
    status,
    reference: row.bank_reference,
    error: outcome.error,
  });
  return describeIntent(intentById(row.id));
}

function noteInConversation(row: IntentRow, result: ActionResult, runId: string) {
  if (!row.conversation_id) return;
  const p = JSON.parse(row.payload) as TransferInput;
  appDb()
    .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)')
    .run(
      randomUUID(),
      row.conversation_id,
      'assistant',
      `Transfer update: ${euros(p.amountCents)} from ${p.fromAccountId} to ${p.toAccountId} ("${p.concept}") is **${String(result.status).replace(/_/g, ' ')}**. ${result.message} Reference: ${row.bank_reference}.`,
      new Date().toISOString(),
      runId,
    );
}

// The only path that sends a transfer to the bank: an unexpired, unconsumed proposal confirmed by
// its holder. Consuming the proposal and claiming the intent happen atomically, so repeated or
// concurrent confirmations return the intent's state instead of sending it again.
export async function confirmApproval(
  userId: string,
  approvalId: string,
  options: { acknowledged?: boolean } = {},
) {
  const db = appDb();
  const approval = db
    .prepare('SELECT * FROM approvals WHERE id=? AND user_id=?')
    .get(approvalId, userId) as ApprovalRow | undefined;
  if (!approval) throw new HttpError(404, 'Proposal not found.');
  const intent = db
    .prepare('SELECT * FROM intents WHERE id=? AND user_id=?')
    .get(approval.intent_id, userId) as IntentRow | undefined;
  if (!intent) throw new HttpError(404, 'Intent not found.');
  if (intent.payload !== approval.payload)
    throw new HttpError(409, 'The proposal no longer matches the transfer details.');
  // Ulises friction (holds and acknowledgements) is enforced before the proposal can be consumed.
  if (!approval.consumed_at) enforceBeforeConfirm(userId, approval.id, !!options.acknowledged);
  const now = new Date().toISOString();
  const claimed = db.transaction(() => {
    const consumed = db
      .prepare(
        'UPDATE approvals SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?',
      )
      .run(now, approval.id, now).changes;
    if (!consumed) return false;
    const updated = db
      .prepare(
        "UPDATE intents SET status='submitting' WHERE id=? AND status='awaiting_confirmation'",
      )
      .run(intent.id).changes;
    if (!updated) throw new HttpError(409, 'This transfer is no longer awaiting confirmation.');
    return true;
  })();
  if (!claimed) {
    const current = intentById(intent.id);
    if (current.status === 'awaiting_confirmation')
      throw new HttpError(409, 'This proposal has expired. Ask for a new transfer proposal.');
    if (current.status === 'cancelled') throw new HttpError(409, 'This proposal was cancelled.');
    return operationStatus(userId, publicId(current));
  }
  const ctx = ctxFor(intent);
  recordEvent(ctx, 'transfer.confirmed', {
    status: 'submitting',
    reference: intent.bank_reference,
  });
  const result = applyOutcome(
    intent,
    await dispatchTransfer(userId, intent.bank_reference!, JSON.parse(intent.payload)),
    ctx,
  );
  noteInConversation(intent, result, ctx.runId);
  return result;
}

export function cancelApproval(userId: string, approvalId: string) {
  const db = appDb();
  const approval = db
    .prepare('SELECT * FROM approvals WHERE id=? AND user_id=?')
    .get(approvalId, userId) as ApprovalRow | undefined;
  if (!approval) throw new HttpError(404, 'Proposal not found.');
  db.transaction(() => {
    const consumed = db
      .prepare('UPDATE approvals SET consumed_at=? WHERE id=? AND consumed_at IS NULL')
      .run(new Date().toISOString(), approval.id).changes;
    if (consumed)
      db.prepare(
        "UPDATE intents SET status='cancelled' WHERE id=? AND status='awaiting_confirmation'",
      ).run(approval.intent_id);
  })();
  const intent = intentById(approval.intent_id);
  if (intent.status === 'cancelled')
    recordEvent(ctxFor(intent), 'transfer.cancelled', { status: 'cancelled' });
  return describeIntent(intent);
}

// Status of an intent (by intent id or bank reference) or of a bare bank reference, always
// re-checked against the ledger when the application's own record is not final.
export async function operationStatus(userId: string, reference: string): Promise<ActionResult> {
  const intent =
    findIntent(userId, reference) ||
    (appDb()
      .prepare('SELECT * FROM intents WHERE user_id=? AND bank_reference=?')
      .get(userId, reference) as IntentRow | undefined);
  if (!intent) {
    const outcome = await verifyTransfer(userId, reference);
    if (outcome.kind === 'completed') return { status: 'completed', operation: outcome.operation };
    if (outcome.kind === 'not_executed')
      return { status: 'not_found', error: 'The bank has no operation with this reference.' };
    return { status: 'unavailable', error: 'The bank could not be queried. Try again later.' };
  }
  const stale = intent.status === 'submitting' && submittedLongAgo(intent);
  if (
    ['awaiting_confirmation', 'cancelled'].includes(intent.status) ||
    (intent.status === 'submitting' && !stale) ||
    !intent.bank_reference
  )
    return describeIntent(intent);
  const outcome = await verifyTransfer(userId, intent.bank_reference);
  if (outcome.kind === 'completed') {
    if (intent.status !== 'completed') return applyOutcome(intent, outcome, ctxFor(intent));
    return describeIntent(intent, outcome.operation);
  }
  if (
    outcome.kind === 'not_executed' &&
    ['pending_verification', 'failed', 'submitting'].includes(intent.status)
  )
    return applyOutcome(intent, outcome, ctxFor(intent));
  // An interrupted dispatch the bank cannot confirm either way is reported as unknown, not "sending".
  if (stale) return applyOutcome(intent, outcome, ctxFor(intent));
  return {
    ...describeIntent(intent),
    ...(outcome.kind === 'unknown' ? { verified: false, error: outcome.error } : {}),
  };
}

function submittedLongAgo(intent: IntentRow) {
  const confirmedAt = pendingApproval(intent.id)?.consumed_at || intent.created_at;
  return Date.now() - Date.parse(confirmedAt) > submitTimeoutMs;
}

// Verifies the customer's interrupted dispatches before their transfers are listed.
export async function reconcileInterrupted(userId: string) {
  const rows = appDb()
    .prepare("SELECT * FROM intents WHERE user_id=? AND status='submitting'")
    .all(userId) as IntentRow[];
  for (const row of rows.filter(submittedLongAgo)) await operationStatus(userId, publicId(row));
}

export function recentIntents(userId: string) {
  return (
    appDb()
      .prepare(
        "SELECT * FROM intents WHERE user_id=? AND status NOT IN ('awaiting_confirmation','cancelled') ORDER BY created_at DESC LIMIT 10",
      )
      .all(userId) as IntentRow[]
  ).map((row) => describeIntent(row));
}

export function conversationIntents(userId: string, conversationId: string) {
  return (
    appDb()
      .prepare('SELECT * FROM intents WHERE user_id=? AND conversation_id=? ORDER BY created_at')
      .all(userId, conversationId) as IntentRow[]
  ).map((row) => describeIntent(row));
}
