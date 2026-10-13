import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { actor, sessionToken, sameOrigin, HttpError } from '../../../src/auth';
import { people, person } from '../../../src/people';
import { appDb } from '../../../src/db';
import { bankRequest, BankError } from '../../../src/banking/client';
import {
  cancelApproval,
  confirmApproval,
  reconcileInterrupted,
  recentIntents,
} from '../../../src/banking/actions';
import { sendMessage, answerWithEvidence } from '../../../src/agent/run';
import { runTool } from '../../../src/agent/tools';
import { caseDetail } from '../../../src/operator/view';
import { documents, readDocument, ingest } from '../../../src/ingestion/pipeline';
import { searchDocuments } from '../../../src/retrieval/search';
import { MissingOpenAIKeyError } from '../../../src/retrieval/embeddings';
import { config } from '../../../src/config';
import { allChunks } from '../../../src/retrieval/store';
import { assessmentForApproval, listRules } from '../../../src/ulises/service';
import { aiUsage, appealLabel } from '../../../src/guardrails/abuse';
import {
  casesForOperators,
  conversationsFor,
  markCaseRead,
  markRead,
  withState,
} from '../../../src/operator/handoff';
import { closeCase, replyToCase } from '../../../src/operator/reply';
import { askDuringCheck } from '../../../src/ulises/checkAssistant';
import { detectMonthly } from '../../../src/ulises/profile';
import {
  checkDraft,
  clearCheckDraft,
  profileView,
  saveCheckDraft,
  saveProfile,
  type Movement,
} from '../../../src/ulises/profile';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
type RouteContext = { params: Promise<{ path: string[] }> };
function conversationFor(id: string, userId: string) {
  const result = appDb()
    .prepare('SELECT * FROM conversations WHERE id=? AND user_id=?')
    .get(id, userId);
  if (!result) throw new HttpError(404, 'Conversation not found.');
  return result;
}
async function handler(request: Request, context: RouteContext) {
  try {
    const { path } = await context.params;
    if (request.method === 'POST') sameOrigin(request);
    const route = path.join('/');
    if (route === 'health')
      return json({
        ok: true,
        service: 'banana-app',
        chatModel: config.chatModel,
        embeddingModel: config.embeddingModel,
        keyConfigured: !!process.env.OPENAI_API_KEY,
      });
    if (route === 'people') return json(people);
    if (route === 'session' && request.method === 'POST') {
      const { userId } = z.object({ userId: z.string() }).parse(await request.json());
      if (!person(userId)) throw new HttpError(400, 'Unknown person.');
      return json({ person: person(userId) }, 200, {
        'Set-Cookie': `banana_actor=${sessionToken(userId)}; Path=/; HttpOnly; SameSite=Strict`,
      });
    }
    const current = actor(request),
      db = appDb();
    if (route === 'session') return json({ person: current });
    if (route === 'dashboard') {
      if (current.role === 'operator')
        return json({
          incidents: casesForOperators(),
        });
      await reconcileInterrupted(current.id);
      const [accounts, movements, contacts] = await Promise.all([
        bankRequest(current.id, '/v1/accounts'),
        bankRequest(current.id, '/v1/movements'),
        bankRequest(current.id, '/v1/contacts'),
      ]);
      const approvals = (
        db
          .prepare(
            'SELECT * FROM approvals WHERE user_id=? AND consumed_at IS NULL AND expires_at>?',
          )
          .all(current.id, new Date().toISOString()) as any[]
      ).map((a) => ({ ...a, payload: JSON.parse(a.payload), ulises: assessmentForApproval(a.id) }));
      return json({
        accounts,
        movements,
        contacts,
        approvals,
        transfers: recentIntents(current.id),
        safetyRules: listRules(current.id),
        ulisesProfile: profileView(current.id, movements as Movement[]),
        ulisesCheckDraft: checkDraft(current.id),
        aiUsage: aiUsage(current.id),
      });
    }
    if (route === 'conversations') {
      if (current.role !== 'customer')
        throw new HttpError(403, 'Select a customer to open a chat.');
      if (request.method === 'POST') {
        const id = randomUUID();
        db.prepare('INSERT INTO conversations VALUES(?,?,?,?)').run(
          id,
          current.id,
          'New conversation',
          new Date().toISOString(),
        );
        return json({ id }, 201);
      }
      return json(conversationsFor(current.id));
    }
    if (path[0] === 'conversations' && path[1]) {
      const conversation = conversationFor(path[1], current.id);
      if (path[2] === 'messages' && request.method === 'POST') {
        const { content } = z
          .object({ content: z.string().trim().min(1).max(8000) })
          .parse(await request.json());
        if ((conversation as any).title === 'New conversation')
          db.prepare('UPDATE conversations SET title=? WHERE id=?').run(
            content.slice(0, 50),
            path[1],
          );
        return json(await sendMessage(current.id, path[1], content));
      }
      markRead(path[1]);
      return json({
        conversation: withState(conversation as { id: string }),
        messages: db
          .prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at,rowid')
          .all(path[1]),
        projections: (
          db
            .prepare(
              "SELECT id,run_id,data,created_at FROM events WHERE conversation_id=? AND kind='ulises.projected' ORDER BY created_at,rowid",
            )
            .all(path[1]) as { id: string; run_id: string; data: string; created_at: string }[]
        )
          .map((p) => ({ ...p, data: JSON.parse(p.data).projection }))
          .filter((p) => p.data),
      });
    }
    if (route === 'actions' && request.method === 'POST') {
      const body = z
        .object({
          name: z.enum([
            'transfer_money',
            'request_human',
            'operation_status',
            'list_accounts',
            'search_documents',
            'set_safety_rule',
            'list_safety_rules',
            'remove_safety_rule',
            'project_purchase',
          ]),
          arguments: z.unknown(),
          conversationId: z.string().nullable().optional(),
          intentId: z.string().max(150).optional(),
        })
        .parse(await request.json());
      if (current.role !== 'customer') throw new HttpError(403, 'A customer is required.');
      if (body.conversationId) conversationFor(body.conversationId, current.id);
      const ctx = {
        userId: current.id,
        conversationId: body.conversationId || null,
        runId: randomUUID(),
        intentId: body.intentId || randomUUID(),
      };
      return json(await runTool(body.name, body.arguments, ctx));
    }
    if (path[0] === 'approvals' && path[1] && request.method === 'POST') {
      if (current.role !== 'customer') throw new HttpError(403, 'A customer is required.');
      if (path[2] === 'confirm') {
        const raw = await request.text();
        const { acknowledged } = z
          .object({ acknowledged: z.boolean().optional() })
          .parse(raw ? JSON.parse(raw) : {});
        return json(await confirmApproval(current.id, path[1], { acknowledged }));
      }
      if (path[2] === 'cancel') return json(cancelApproval(current.id, path[1]));
    }
    if (route === 'ulises/check-ask' && request.method === 'POST') {
      if (current.role !== 'customer') throw new HttpError(403, 'A customer is required.');
      const movements = await bankRequest<Movement[]>(current.id, '/v1/movements');
      return json(await askDuringCheck(await request.json(), detectMonthly(movements)));
    }
    if (route === 'ulises/check-draft' || route === 'ulises/check-draft/clear') {
      if (current.role !== 'customer') throw new HttpError(403, 'A customer is required.');
      if (request.method === 'GET') return json({ draft: checkDraft(current.id) });
      if (route === 'ulises/check-draft/clear') return json(clearCheckDraft(current.id));
      return json(saveCheckDraft(current.id, await request.json()));
    }
    if (route === 'ulises/profile') {
      if (current.role !== 'customer') throw new HttpError(403, 'A customer is required.');
      const movements = await bankRequest<Movement[]>(current.id, '/v1/movements');
      if (request.method === 'GET') return json(profileView(current.id, movements));
      const ctx = {
        userId: current.id,
        conversationId: null,
        runId: randomUUID(),
        intentId: randomUUID(),
      };
      return json(saveProfile(ctx, await request.json(), movements));
    }
    if (route === 'ai-usage/appeal' && request.method === 'POST') {
      if (current.role !== 'customer') throw new HttpError(403, 'A customer is required.');
      return json(appealLabel(current.id));
    }
    if (path[0] === 'incidents') {
      if (current.role !== 'operator') throw new HttpError(403, 'Operator role required.');
      if (!path[1]) return json(casesForOperators());
      if (path[2] === 'reply' && request.method === 'POST') {
        const { content } = z
          .object({ content: z.string().trim().min(1).max(4000) })
          .parse(await request.json());
        const sent = replyToCase(current.id, path[1], content);
        markCaseRead(path[1]);
        return json(sent);
      }
      if (path[2] === 'close' && request.method === 'POST')
        return json(closeCase(current.id, path[1]));
      const detail = await caseDetail(current.id, path[1]);
      markCaseRead(path[1]);
      return json(detail);
    }
    if (path[0] === 'documents') {
      const visible = documents().filter(
        (d) => current.role === 'operator' || d.audience === 'public',
      );
      if (path[1]) {
        const doc = visible.find((d) => d.id === path[1]);
        if (!doc) throw new HttpError(404, 'Document not found.');
        if (path[2] === 'chunks')
          return json(
            allChunks()
              .filter((c) => c.documentId === doc.id)
              .map(({ vector, ...c }) => c),
          );
        return json({ ...doc, text: readDocument(doc) });
      }
      return json({
        documents: visible,
        index: db.prepare('SELECT COUNT(*) AS chunks FROM chunks').get(),
      });
    }
    if (route === 'preview-answer' && request.method === 'POST') {
      if (current.role !== 'operator') throw new HttpError(403, 'Operator role required.');
      const body = z
        .object({
          question: z.string().min(1).max(8000),
          sources: z
            .array(
              z.object({
                id: z.string(),
                documentId: z.string(),
                text: z.string().max(12000),
                title: z.string().nullable(),
                version: z.number().nullable(),
                validFrom: z.string().nullable(),
                validTo: z.string().nullable(),
                audience: z.enum(['public', 'internal']),
                score: z.number(),
              }),
            )
            .max(10),
        })
        .parse(await request.json());
      return json(await answerWithEvidence(body.question, body.sources));
    }
    if (route === 'search' && request.method === 'POST') {
      const { query } = z
        .object({ query: z.string().min(1).max(2000) })
        .parse(await request.json());
      return json({ sources: await searchDocuments(query, current.role) });
    }
    if (route === 'ingestion' && request.method === 'POST') {
      if (current.role !== 'operator') throw new HttpError(403, 'Operator role required.');
      return json(await ingest());
    }
    throw new HttpError(404, 'Route not found.');
  } catch (e) {
    if (e instanceof MissingOpenAIKeyError)
      return json({ error: e.message, code: 'missing_openai_api_key' }, 503);
    if (e instanceof HttpError && e.code) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof HttpError || e instanceof BankError)
      return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return json({ error: 'Invalid request data.' }, 400);
    console.error('app_request_failed', e instanceof Error ? e.name : 'unknown');
    return json(
      { error: 'The request could not be completed. Check the service and configuration.' },
      500,
    );
  }
}
export const GET = handler;
export const POST = handler;
