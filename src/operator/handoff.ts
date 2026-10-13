import { randomUUID } from 'node:crypto';
import { appDb } from '../db';
import { HttpError } from '../auth';
import { recordEvent } from '../telemetry';
import { replyLanguage } from '../agent/replies';
import { caseNumber } from './case-number';

export { caseNumber };

// A conversation is with the assistant until it has a support case. While the case is open a person
// owns it: the assistant stays silent and the customer's messages wait for the operator. Once the
// case is resolved the conversation is closed for good; anything new starts a new conversation.
export type ConversationState =
  | { status: 'assistant' }
  | { status: 'support'; caseId: string }
  | { status: 'closed'; caseId: string };

export function conversationState(conversationId: string): ConversationState {
  const cases = appDb()
    .prepare('SELECT id,status FROM incidents WHERE conversation_id=? ORDER BY created_at DESC')
    .all(conversationId) as { id: string; status: string }[];
  const open = cases.find((c) => c.status === 'open');
  if (open) return { status: 'support', caseId: open.id };
  if (cases.length) return { status: 'closed', caseId: cases[0].id };
  return { status: 'assistant' };
}

export function messageForSupport(userId: string, conversationId: string, content: string) {
  const state = conversationState(conversationId);
  if (state.status === 'closed')
    throw new HttpError(
      409,
      `Case ${caseNumber(state.caseId)} is resolved and this conversation is closed. Start a new conversation if you need anything else.`,
    );
  if (state.status !== 'support') return undefined;
  const db = appDb(),
    runId = randomUUID(),
    messageId = randomUUID();
  db.transaction(() => {
    db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(
      messageId,
      conversationId,
      'user',
      content,
      new Date().toISOString(),
      null,
    );
    recordEvent({ userId, conversationId, runId, intentId: runId }, 'support.customer_message', {
      status: 'waiting_for_operator',
      incidentId: state.caseId,
      messageId,
    });
  })();
  return { handoff: true, incidentId: state.caseId, answer: null };
}

// Written by the support team when the case is resolved, in the customer's language.
export function resolutionMessage(conversationId: string, caseId: string) {
  const sample = (
    appDb()
      .prepare(
        "SELECT content FROM messages WHERE conversation_id=? AND role='user' ORDER BY created_at DESC,rowid DESC LIMIT 3",
      )
      .all(conversationId) as { content: string }[]
  )
    .map((m) => m.content)
    .join('\n');
  const n = caseNumber(caseId);
  return replyLanguage(sample) === 'es'
    ? `Hemos resuelto tu caso ${n}. Esta conversación queda cerrada; si necesitas algo más, abre una conversación nueva.`
    : `Your case ${n} is resolved. This conversation is now closed; start a new conversation if you need anything else.`;
}

// Opening a conversation marks the support team's messages in it as seen.
export function markRead(conversationId: string) {
  appDb()
    .prepare(
      'INSERT INTO conversation_reads VALUES(?,?) ON CONFLICT(conversation_id) DO UPDATE SET read_at=excluded.read_at',
    )
    .run(conversationId, new Date().toISOString());
}

// The customer's conversation list, with who owns each one and how many support messages the
// customer has not opened yet.
export function conversationsFor(userId: string) {
  const rows = appDb()
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.role='operator'
          AND m.created_at > COALESCE((SELECT read_at FROM conversation_reads r WHERE r.conversation_id=c.id), '')) AS unread
      FROM conversations c WHERE c.user_id=? ORDER BY c.created_at DESC`,
    )
    .all(userId) as { id: string }[];
  return rows.map((c) => withState(c));
}

export function withState<T extends { id: string }>(conversation: T) {
  const state = conversationState(conversation.id);
  return {
    ...conversation,
    state: state.status,
    caseNumber: 'caseId' in state ? caseNumber(state.caseId) : null,
  };
}

// The operators' inbox. A case has news for support when the customer wrote after it was opened
// and after an operator last looked at it.
export function casesForOperators() {
  return appDb()
    .prepare(
      `SELECT i.*,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=i.conversation_id AND m.role='user'
          AND m.created_at > MAX(i.created_at, COALESCE((SELECT read_at FROM case_reads r WHERE r.incident_id=i.id), ''))) AS customer_unread
      FROM incidents i ORDER BY i.created_at DESC`,
    )
    .all();
}

export function markCaseRead(incidentId: string) {
  appDb()
    .prepare(
      'INSERT INTO case_reads VALUES(?,?) ON CONFLICT(incident_id) DO UPDATE SET read_at=excluded.read_at',
    )
    .run(incidentId, new Date().toISOString());
}
