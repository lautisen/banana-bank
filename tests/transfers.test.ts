// End-to-end checks for the transfer flow: application route handler -> signed HTTP -> simulated bank.
// The bank runs as a separate process on a random port with its own data directory, and its
// supported failure scenarios are switched through the admin API (test-only observation).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { caseNumber } from '../src/operator/case-number';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-transfers-'));
const port = await new Promise<number>((resolve) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => {
    const p = (srv.address() as net.AddressInfo).port;
    srv.close(() => resolve(p));
  });
});
const bankUrl = `http://127.0.0.1:${port}`;
const admin = { Authorization: 'Bearer banana-local-admin', 'Content-Type': 'application/json' };
Object.assign(process.env, {
  DATA_DIR: path.join(temp, 'app'),
  BANK_DATA_DIR: path.join(temp, 'bank'),
  BANK_PORT: String(port),
  BANK_URL: bankUrl,
  BANK_SERVICE_SECRET: 'banana-local-service',
  BANK_ADMIN_SECRET: 'banana-local-admin',
});
const { seedApp } = await import('../src/seed');
const { appDb, closeAppDb } = await import('../src/db');
const { sessionToken } = await import('../src/auth');
const route = await import('../app/api/[...path]/route');

let bank: ChildProcess | undefined;
async function startBank() {
  bank = spawn(process.execPath, ['--import', 'tsx', 'simulator/server.ts'], {
    env: process.env,
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${bankUrl}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('bank did not start');
}
async function stopBank() {
  if (!bank || bank.exitCode !== null) return;
  const exited = new Promise((r) => bank!.once('exit', r));
  bank.kill('SIGTERM');
  await exited;
}
async function adminPost(pathname: string, body: unknown = {}) {
  const r = await fetch(`${bankUrl}${pathname}`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify(body),
  });
  assert.equal(r.status, 200, `admin ${pathname}`);
}
async function snapshot() {
  return (await (await fetch(`${bankUrl}/admin/snapshot`, { headers: admin })).json()) as {
    accounts: { id: string; balanceCents: number }[];
    operations: { reference: string; amountCents: number; concept: string }[];
  };
}
async function reset(profile = 'normal', seed = 17) {
  await adminPost('/admin/reset');
  await adminPost('/admin/scenario', { profile, seed });
  seedApp();
}
async function call(user: string, method: 'GET' | 'POST', pathname: string, body?: unknown) {
  const response = await (method === 'GET' ? route.GET : route.POST)(
    new Request(`http://127.0.0.1:3000/api/${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        cookie: `banana_actor=${sessionToken(user)}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: pathname.split('?')[0].split('/') }) },
  );
  return { status: response.status, body: (await response.json()) as any };
}
const balance = async (id: string) =>
  (await snapshot()).accounts.find((a) => a.id === id)!.balanceCents;
const opsWith = async (concept: string) =>
  (await snapshot()).operations.filter((o) => o.concept === concept);
function propose(user: string, amountCents: number, concept: string, extra: object = {}) {
  return call(user, 'POST', 'actions', {
    name: 'transfer_money',
    arguments: { fromAccountId: `acc-${user}`, toAccountId: 'acc-bruno', amountCents, concept },
    ...extra,
  });
}
async function proposeAndConfirm(amountCents: number, concept: string) {
  const proposal = await propose('lucia', amountCents, concept);
  assert.equal(proposal.body.status, 'requires_confirmation', JSON.stringify(proposal.body));
  return call('lucia', 'POST', `approvals/${proposal.body.approval.id}/confirm`, {});
}

before(startBank);
after(async () => {
  await stopBank();
  closeAppDb();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('a transfer request only creates a proposal; nothing moves before confirmation', async () => {
  await reset();
  const before = await balance('acc-lucia');
  const r = await propose('lucia', 1500, 'proposal only');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'requires_confirmation');
  assert.equal(r.body.approval.payload.amountCents, 1500);
  assert.equal(r.body.approval.payload.fromAccountId, 'acc-lucia');
  assert.equal(r.body.approval.payload.toAccountId, 'acc-bruno');
  assert.equal(await balance('acc-lucia'), before);
  assert.equal((await opsWith('proposal only')).length, 0);
  const dashboard = await call('lucia', 'GET', 'dashboard');
  assert.ok(dashboard.body.approvals.some((a: any) => a.id === r.body.approval.id));
});

test('confirming a proposal executes exactly one transfer', async () => {
  await reset();
  const before = await balance('acc-lucia');
  const r = await proposeAndConfirm(1000, 'normal once');
  assert.equal(r.body.status, 'completed');
  assert.equal((await opsWith('normal once')).length, 1);
  assert.equal(await balance('acc-lucia'), before - 1000);
});

for (const profile of ['lost-response', 'slow-response', 'read-unavailable', 'reject-before']) {
  test(`${profile}: one confirmed intent moves money exactly once and reports the verified result`, async () => {
    await reset(profile);
    const before = await balance('acc-lucia');
    const r = await proposeAndConfirm(1000, `${profile} once`);
    assert.equal((await opsWith(`${profile} once`)).length, 1, 'exactly one bank operation');
    assert.equal(await balance('acc-lucia'), before - 1000);
    assert.equal(r.body.status, 'completed', JSON.stringify(r.body));
  });
}

test('intermittent 17: three distinct intents produce exactly three operations', async () => {
  await reset('intermittent', 17);
  const before = await balance('acc-lucia');
  for (let i = 0; i < 3; i++) {
    const r = await proposeAndConfirm(500, 'intermittent');
    assert.equal(r.body.status, 'completed');
  }
  assert.equal((await opsWith('intermittent')).length, 3);
  assert.equal(await balance('acc-lucia'), before - 1500);
});

test('two distinct intents with identical payloads are two transfers', async () => {
  await reset();
  await proposeAndConfirm(700, 'same payload');
  await proposeAndConfirm(700, 'same payload');
  assert.equal((await opsWith('same payload')).length, 2);
});

test('confirming the same proposal again (sequentially or concurrently) never repeats the effect', async () => {
  await reset('lost-response');
  const proposal = await propose('lucia', 900, 'confirm twice');
  const id = proposal.body.approval.id;
  const [a, b] = await Promise.all([
    call('lucia', 'POST', `approvals/${id}/confirm`, {}),
    call('lucia', 'POST', `approvals/${id}/confirm`, {}),
  ]);
  const c = await call('lucia', 'POST', `approvals/${id}/confirm`, {});
  assert.equal((await opsWith('confirm twice')).length, 1);
  assert.ok([a, b, c].every((r) => r.status === 200));
  assert.equal(c.body.status, 'completed');
});

test('retrying the same intentId returns the same proposal instead of a new one', async () => {
  await reset();
  const a = await propose('lucia', 800, 'same intent', { intentId: 'client-intent-1' });
  const b = await propose('lucia', 800, 'same intent', { intentId: 'client-intent-1' });
  assert.equal(a.body.approval.id, b.body.approval.id);
  const changed = await propose('lucia', 801, 'same intent', { intentId: 'client-intent-1' });
  assert.equal(changed.body.status, 'conflict');
  assert.equal(changed.body.approval, undefined);
});

test('an intentId used by another customer does not reveal or block anything', async () => {
  await reset();
  await propose('lucia', 800, 'shared id', { intentId: 'shared-intent' });
  const other = await call('elena', 'POST', 'actions', {
    name: 'transfer_money',
    intentId: 'shared-intent',
    arguments: {
      fromAccountId: 'acc-elena',
      toAccountId: 'acc-hugo',
      amountCents: 100,
      concept: 'mine',
    },
  });
  assert.equal(other.body.status, 'requires_confirmation');
});

test('expired, foreign or cancelled proposals cannot be executed', async () => {
  await reset();
  const expired = await propose('lucia', 600, 'expired');
  appDb()
    .prepare('UPDATE approvals SET expires_at=? WHERE id=?')
    .run('2000-01-01T00:00:00.000Z', expired.body.approval.id);
  const r1 = await call('lucia', 'POST', `approvals/${expired.body.approval.id}/confirm`, {});
  assert.equal(r1.status, 409);
  const foreign = await propose('lucia', 600, 'foreign');
  const r2 = await call('bruno', 'POST', `approvals/${foreign.body.approval.id}/confirm`, {});
  assert.equal(r2.status, 404);
  const cancelled = await propose('lucia', 600, 'cancelled');
  const r3 = await call('lucia', 'POST', `approvals/${cancelled.body.approval.id}/cancel`, {});
  assert.equal(r3.body.status, 'cancelled');
  const r4 = await call('lucia', 'POST', `approvals/${cancelled.body.approval.id}/confirm`, {});
  assert.equal(r4.status, 409);
  assert.equal((await opsWith('expired')).length, 0);
  assert.equal((await opsWith('foreign')).length, 0);
  assert.equal((await opsWith('cancelled')).length, 0);
});

test('insufficient funds is reported as a rejection with no proposal to confirm', async () => {
  await reset();
  const r = await call('diego', 'POST', 'actions', {
    name: 'transfer_money',
    arguments: {
      fromAccountId: 'acc-diego',
      toAccountId: 'acc-ines',
      amountCents: 20000,
      concept: 'too much',
    },
  });
  assert.equal(r.body.status, 'rejected');
  assert.match(r.body.error, /insufficient/i);
  assert.equal(r.body.approval, undefined);
});

test('when the bank cannot be reached the status is "pending verification", never a false failure', async () => {
  await reset();
  const proposal = await propose('lucia', 1200, 'bank down');
  await stopBank();
  try {
    const r = await call('lucia', 'POST', `approvals/${proposal.body.approval.id}/confirm`, {});
    assert.equal(r.body.status, 'pending_verification', JSON.stringify(r.body));
  } finally {
    await startBank();
  }
  const status = await call('lucia', 'POST', 'actions', {
    name: 'operation_status',
    arguments: { reference: proposal.body.intentId },
  });
  assert.equal(status.body.status, 'not_executed', JSON.stringify(status.body));
  assert.equal((await opsWith('bank down')).length, 0);
});

test('operation_status by intent reconciles the historic dinner payment with the bank ledger', async () => {
  await reset();
  const r = await call('lucia', 'POST', 'actions', {
    name: 'operation_status',
    arguments: { reference: 'intent-historic-lucia' },
  });
  assert.equal(r.body.status, 'completed', JSON.stringify(r.body));
  assert.equal(r.body.operation.reference, 'ref-historic-lucia');
});

test('operators see the conversation, recorded agent steps, intents and bank effects of a case', async () => {
  await reset();
  const conversation = await call('lucia', 'POST', 'conversations', {});
  const conversationId = conversation.body.id;
  const proposal = await propose('lucia', 1100, 'case evidence', { conversationId });
  await call('lucia', 'POST', `approvals/${proposal.body.approval.id}/confirm`, {});
  const human = await call('lucia', 'POST', 'actions', {
    name: 'request_human',
    arguments: { summary: 'Please check my transfer' },
    conversationId,
  });
  const detail = await call('marta', 'GET', `incidents/${human.body.incidentId}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.events.length >= 2);
  assert.ok(detail.body.events.some((e: any) => e.data.arguments?.amountCents === 1100));
  assert.equal(detail.body.intents.length, 1);
  assert.equal(detail.body.intents[0].status, 'completed');
  assert.ok(
    detail.body.bank.operations.some((o: any) => o.reference === detail.body.intents[0].reference),
  );

  const historic = await call('marta', 'GET', 'incidents/case-lucia');
  assert.equal(historic.body.history.length, 3);
  assert.equal(historic.body.events.length, 0);
  assert.match(historic.body.gaps, /no agent activity was recorded/i);
  assert.match(historic.body.gaps, /intent-historic-lucia/);
  const customerView = await call('lucia', 'GET', 'incidents/case-lucia');
  assert.equal(customerView.status, 403);
});

// Simulates a dispatch interrupted after the claim (e.g. a restart): the intent stays "submitting".
function interrupt(intentId: string, user: string, secondsAgo: number) {
  const id = `${user}:${intentId}`,
    at = new Date(Date.now() - secondsAgo * 1000).toISOString();
  appDb().prepare("UPDATE intents SET status='submitting' WHERE id=?").run(id);
  appDb().prepare('UPDATE approvals SET consumed_at=? WHERE intent_id=?').run(at, id);
}

test('an interrupted dispatch is verified by reference after the timeout, never left "processing"', async () => {
  await reset();
  // Never reached the bank: after the timeout it is reported as not executed.
  const lost = await propose('lucia', 1300, 'interrupted before bank');
  interrupt(lost.body.intentId, 'lucia', 5);
  const fresh = await call('lucia', 'POST', 'actions', {
    name: 'operation_status',
    arguments: { reference: lost.body.intentId },
  });
  assert.equal(fresh.body.status, 'processing', 'still inside the timeout');
  interrupt(lost.body.intentId, 'lucia', 120);
  const dashboard = await call('lucia', 'GET', 'dashboard');
  const listed = dashboard.body.transfers.find((t: any) => t.intentId === lost.body.intentId);
  assert.equal(listed.status, 'not_executed', JSON.stringify(listed));
  assert.equal((await opsWith('interrupted before bank')).length, 0);

  // Committed by the bank before the interruption: reported as completed, once.
  const done = await proposeAndConfirm(1400, 'interrupted after commit');
  assert.equal(done.body.status, 'completed');
  interrupt(done.body.intentId, 'lucia', 120);
  const status = await call('lucia', 'POST', 'actions', {
    name: 'operation_status',
    arguments: { reference: done.body.intentId },
  });
  assert.equal(status.body.status, 'completed', JSON.stringify(status.body));
  assert.equal((await opsWith('interrupted after commit')).length, 1);
});

test('asking for a human again adds to the open case instead of dropping the new summary', async () => {
  await reset();
  const conversationId = (await call('lucia', 'POST', 'conversations', {})).body.id;
  const ask = (summary: string) =>
    call('lucia', 'POST', 'actions', {
      name: 'request_human',
      arguments: { summary },
      conversationId,
    });
  const first = await ask('Card payment looks duplicated');
  const second = await ask('Customer adds: it happened on 20 September');
  assert.equal(second.body.incidentId, first.body.incidentId);
  assert.equal(second.body.updated, true);
  const detail = await call('marta', 'GET', `incidents/${first.body.incidentId}`);
  assert.match(detail.body.incident.summary, /Card payment looks duplicated/);
  assert.match(detail.body.incident.summary, /it happened on 20 September/);
});

test('operators reply inside the customer conversation and resolve the case', async () => {
  await reset();
  const conversationId = (await call('lucia', 'POST', 'conversations', {})).body.id;
  const human = await call('lucia', 'POST', 'actions', {
    name: 'request_human',
    arguments: { summary: 'My card was charged twice' },
    conversationId,
  });
  const id = human.body.incidentId;
  assert.equal(
    (await call('lucia', 'POST', `incidents/${id}/reply`, { content: 'x' })).status,
    403,
  );
  assert.equal(
    (await call('marta', 'POST', `incidents/${id}/reply`, { content: ' ' })).status,
    400,
  );

  const sent = await call('marta', 'POST', `incidents/${id}/reply`, {
    content: 'We have refunded the duplicate charge.',
  });
  assert.equal(sent.status, 200);
  const chat = await call('lucia', 'GET', `conversations/${conversationId}`);
  assert.deepEqual(
    chat.body.messages.map((m: any) => [m.role, m.content]),
    [['operator', 'We have refunded the duplicate charge.']],
  );
  const detail = await call('marta', 'GET', `incidents/${id}`);
  assert.ok(
    detail.body.events.some(
      (e: any) => e.kind === 'operator.replied' && e.data.operatorId === 'marta',
    ),
  );

  assert.equal((await call('marta', 'POST', `incidents/${id}/close`, {})).status, 200);
  const cases = await call('marta', 'GET', 'incidents');
  assert.equal(cases.body.find((c: any) => c.id === id).status, 'closed');
  const late = await call('marta', 'POST', `incidents/${id}/reply`, { content: 'One more thing' });
  assert.equal(late.status, 409);
  assert.equal((await call('marta', 'POST', 'incidents/missing/close', {})).status, 404);
});

test('a conversation with support is answered by a person, and closes for good when resolved', async () => {
  await reset();
  const conversationId = (await call('lucia', 'POST', 'conversations', {})).body.id;
  const id = (
    await call('lucia', 'POST', 'actions', {
      name: 'request_human',
      arguments: { summary: 'My card was charged twice' },
      conversationId,
    })
  ).body.incidentId;
  const number = caseNumber(id);
  const listed = async () =>
    (await call('lucia', 'GET', 'conversations')).body.find((c: any) => c.id === conversationId);
  assert.equal((await listed()).state, 'support');

  // The assistant does not run: the message waits for the operator (no model call is made here).
  const sent = await call('lucia', 'POST', `conversations/${conversationId}/messages`, {
    content: 'It was on 20 September, 42 euros',
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.handoff, true);
  assert.equal(sent.body.answer, null);
  // Operators see that the customer wrote until one of them opens the case.
  const inbox = async () =>
    (await call('marta', 'GET', 'incidents')).body.find((c: any) => c.id === id).customer_unread;
  assert.equal(await inbox(), 1);
  const detail = await call('marta', 'GET', `incidents/${id}`);
  assert.ok(detail.body.events.some((e: any) => e.kind === 'support.customer_message'));
  assert.equal(await inbox(), 0);

  // An operator reply is unread until the customer opens the conversation.
  await call('marta', 'POST', `incidents/${id}/reply`, { content: 'We are checking it.' });
  assert.equal((await listed()).unread, 1);
  await call('lucia', 'GET', `conversations/${conversationId}`);
  assert.equal((await listed()).unread, 0);

  // Resolving tells the customer, with the case number, and closes the conversation.
  await call('marta', 'POST', `incidents/${id}/close`, {});
  const closed = await listed();
  assert.equal(closed.state, 'closed');
  assert.equal(closed.caseNumber, number);
  assert.equal(closed.unread, 1);
  const chat = await call('lucia', 'GET', `conversations/${conversationId}`);
  const last = chat.body.messages.at(-1);
  assert.equal(last.role, 'operator');
  assert.ok(last.content.includes(number));
  assert.match(last.content, /resolved/);
  const late = await call('lucia', 'POST', `conversations/${conversationId}/messages`, {
    content: 'One more thing',
  });
  assert.equal(late.status, 409);
  assert.ok(late.body.error.includes(number));
  assert.equal(
    (await call('lucia', 'GET', `conversations/${conversationId}`)).body.messages.length,
    chat.body.messages.length,
  );
});
