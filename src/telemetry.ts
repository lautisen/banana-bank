import { randomUUID } from 'node:crypto';
import { appDb } from './db';
import type { ToolContext } from './types';

const maxEventBytes = 16000;

// Keeps what operators need to understand a case afterwards: arguments, results, errors and
// references. Oversized payloads are truncated explicitly rather than silently dropped.
export function recordEvent(ctx: ToolContext, kind: string, data: Record<string, unknown>) {
  let serialized = JSON.stringify({ intentId: ctx.intentId, ...data });
  if (serialized.length > maxEventBytes)
    serialized = JSON.stringify({
      tool: data.tool,
      status: data.status,
      truncated: true,
      preview: serialized.slice(0, maxEventBytes),
    });
  appDb()
    .prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)')
    .run(
      randomUUID(),
      ctx.runId,
      ctx.userId,
      ctx.conversationId,
      kind,
      serialized,
      new Date().toISOString(),
    );
}
