import { randomUUID } from 'node:crypto';
import { appDb } from '../db';
import { person } from '../people';
import { HttpError } from '../auth';
import { recordEvent } from '../telemetry';
import { caseNumber, resolutionMessage } from './handoff';

type Incident = { id: string; user_id: string; conversation_id: string; status: string };

function openCase(operatorId: string, id: string) {
  if (person(operatorId)?.role !== 'operator') throw new HttpError(403, 'Operator role required.');
  const incident = appDb().prepare('SELECT * FROM incidents WHERE id=?').get(id) as
    Incident | undefined;
  if (!incident) throw new HttpError(404, 'Case not found.');
  if (incident.status !== 'open') throw new HttpError(409, 'This case is already resolved.');
  return incident;
}

// The operator answers inside the customer's own conversation, so the reply appears in their chat
// and the assistant reads it as part of the history. Who answered is kept in the case's events.
export function replyToCase(operatorId: string, id: string, content: string) {
  const incident = openCase(operatorId, id),
    db = appDb(),
    runId = randomUUID(),
    messageId = randomUUID(),
    now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(
      messageId,
      incident.conversation_id,
      'operator',
      content,
      now,
      null,
    );
    recordEvent(
      {
        userId: incident.user_id,
        conversationId: incident.conversation_id,
        runId,
        intentId: runId,
      },
      'operator.replied',
      { status: 'sent', operatorId, messageId },
    );
  })();
  return { status: 'sent', messageId };
}

// Resolving the case closes the customer's conversation for good and tells them so, with the case
// number, in the conversation itself.
export function closeCase(operatorId: string, id: string) {
  const incident = openCase(operatorId, id),
    db = appDb(),
    runId = randomUUID(),
    messageId = randomUUID();
  db.transaction(() => {
    db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(
      messageId,
      incident.conversation_id,
      'operator',
      resolutionMessage(incident.conversation_id, id),
      new Date().toISOString(),
      null,
    );
    db.prepare("UPDATE incidents SET status='closed' WHERE id=?").run(id);
    recordEvent(
      {
        userId: incident.user_id,
        conversationId: incident.conversation_id,
        runId,
        intentId: runId,
      },
      'operator.closed',
      { status: 'closed', operatorId, messageId },
    );
  })();
  return { status: 'closed', caseNumber: caseNumber(id) };
}
