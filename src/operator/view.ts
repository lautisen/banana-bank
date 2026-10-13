import { appDb } from '../db';
import { person } from '../people';
import { HttpError } from '../auth';
import { bankRequest } from '../banking/client';
import { describeIntent, type IntentRow } from '../banking/actions';
import { assessmentForIntent } from '../ulises/service';
import { aiUsage } from '../guardrails/abuse';
import type { Account, Operation } from '../types';

type Incident = {
  id: string;
  user_id: string;
  conversation_id: string;
  summary: string;
  status: string;
  created_at: string;
};
type EventRow = { id: string; run_id: string; kind: string; data: string; created_at: string };

// Everything an operator needs for a case, taken only from recorded evidence: the conversation,
// the agent's recorded steps, the transfer intents and the bank ledger. Missing records and
// disagreements between the application and the bank are listed as gaps, never filled in.
export async function caseDetail(operatorId: string, id: string) {
  if (person(operatorId)?.role !== 'operator') throw new HttpError(403, 'Operator role required.');
  const db = appDb();
  const incident = db.prepare('SELECT * FROM incidents WHERE id=?').get(id) as Incident | undefined;
  if (!incident) throw new HttpError(404, 'Case not found.');
  const history = db
    .prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at,rowid')
    .all(incident.conversation_id) as { id: string; content: string }[];
  const events = (
    db
      .prepare('SELECT * FROM events WHERE conversation_id=? ORDER BY created_at,rowid')
      .all(incident.conversation_id) as EventRow[]
  ).map((e) => ({ ...e, data: JSON.parse(e.data) }));
  const intentRows = db
    .prepare('SELECT * FROM intents WHERE conversation_id=? AND user_id=? ORDER BY created_at')
    .all(incident.conversation_id, incident.user_id) as IntentRow[];
  const gaps: string[] = [];
  let bank: { accounts: Account[]; operations: Operation[] } | null = null;
  try {
    bank = await bankRequest(
      operatorId,
      `/v1/operator/customer?id=${encodeURIComponent(incident.user_id)}`,
    );
  } catch (e) {
    gaps.push(
      `The bank could not be queried (${e instanceof Error ? e.message : 'error'}); bank effects are unverified.`,
    );
  }
  if (!events.length)
    gaps.push(
      'No agent activity was recorded for this conversation. Steps that were not recorded are not reconstructed.',
    );
  const intents = intentRows.map((row) => {
    const operation = bank?.operations.find((o) => o.reference === row.bank_reference) || null;
    const described = describeIntent(row);
    if (bank) {
      if (operation && row.status !== 'completed')
        gaps.push(
          `Intent ${described.intentId} is recorded as "${row.status}" in the application, but the bank ledger shows completed operation ${operation.id} (${(operation.amountCents / 100).toFixed(2)} EUR, reference ${operation.reference}). Money did move.`,
        );
      if (!operation && row.status === 'completed')
        gaps.push(
          `Intent ${described.intentId} is recorded as completed but no bank operation has reference ${row.bank_reference}.`,
        );
    }
    return {
      ...described,
      createdAt: row.created_at,
      bankOperation: operation,
      ulises: assessmentForIntent(row.id),
    };
  });
  return {
    incident,
    customer: person(incident.user_id),
    aiUsage: aiUsage(incident.user_id),
    lastMessage: history.at(-1) || null,
    history,
    events,
    intents,
    bank,
    gaps: gaps.join('\n'),
  };
}
