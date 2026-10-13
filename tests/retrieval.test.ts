// Retrieval and answer-construction checks that run without an OpenAI key: the query embedding is
// placed in the embedding cache, so search uses the supplied index exactly as in production.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-retrieval-'));
process.env.DATA_DIR = temp;
process.env.BANK_DATA_DIR = temp;
const { seedApp } = await import('../src/seed');
const { appDb, closeAppDb } = await import('../src/db');
const { searchDocuments } = await import('../src/retrieval/search');
const { embeddingKey, vectorBuffer } = await import('../src/retrieval/embeddings');
const { allChunks } = await import('../src/retrieval/store');
const { knowledgeInstructions } = await import('../src/agent/prompt');

seedApp();
// A probe whose embedding equals the archived Aurora terms chunk: the worst case for mixing an
// expired fee (EUR 8) into an answer about the current one.
function probe(text: string, documentId: string, needle: string) {
  const chunk = allChunks().find((c) => c.documentId === documentId && c.text.includes(needle))!;
  appDb()
    .prepare('INSERT OR REPLACE INTO embedding_cache VALUES(?,?)')
    .run(embeddingKey(text), vectorBuffer(chunk.vector!));
  return text;
}

test('every search result carries its title, version and validity window', async () => {
  const results = await searchDocuments(probe('probe-aurora-fee', 'aurora-fees-2026', 'EUR 6'));
  assert.equal(results.length, 5);
  for (const r of results) {
    assert.ok(r.title, `title for ${r.documentId}`);
    assert.ok(r.version, `version for ${r.documentId}`);
    assert.ok(r.validFrom, `validFrom for ${r.documentId}`);
    assert.ok(r.validity);
  }
});

test('archived versions are labelled, limited to one and ranked after current sources', async () => {
  const results = await searchDocuments(
    probe('probe-aurora-archive', 'archive-aurora-1', 'Historical document'),
  );
  const historical = results.filter((r) => r.validity === 'historical');
  assert.ok(historical.length <= 1, JSON.stringify(results.map((r) => r.documentId)));
  assert.ok(results.some((r) => r.validity === 'current'));
  const firstHistorical = results.findIndex((r) => r.validity === 'historical');
  if (firstHistorical >= 0)
    assert.ok(results.slice(firstHistorical).every((r) => r.validity === 'historical'));
});

test('no document contributes more than two chunks to one answer', async () => {
  const results = await searchDocuments(probe('probe-guide', 'context-guide-1', 'Support guide 1'));
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.documentId, (counts.get(r.documentId) || 0) + 1);
  assert.ok(
    [...counts.values()].every((n) => n <= 2),
    JSON.stringify([...counts]),
  );
});

test('customers never retrieve internal procedures', async () => {
  const results = await searchDocuments(probe('probe-procedure', 'procedure-8', 'retries'));
  assert.ok(results.every((r) => r.audience === 'public'));
});

test('answer instructions require evidence and forbid estimates', async () => {
  const sources = await searchDocuments('probe-aurora-archive');
  const text = knowledgeInstructions(sources);
  assert.doesNotMatch(text, /common banking practice|estimate so the customer/i);
  assert.match(text, /\[documentId vN\]/);
  assert.match(text, /"validity":"historical"|"validity":"current"/);
});

test("a generic question always includes the customer's own product documentation", async () => {
  // A probe equal to another product's fee terms: similarity alone ranks Cloud first.
  const query = probe('probe-generic-fee', 'cloud-fees-2026', 'Terms and exceptions');
  const plain = await searchDocuments(query);
  assert.ok(!plain.some((r) => r.documentId.startsWith('aurora-')));
  const own = await searchDocuments(query, 'customer', 5, ['aurora']);
  assert.ok(
    own.some((r) => r.documentId.startsWith('aurora-')),
    JSON.stringify(own.map((r) => r.documentId)),
  );
  assert.equal(own[0].documentId, 'cloud-fees-2026', 'the closest match keeps its place');
});

after(() => {
  closeAppDb();
  fs.rmSync(temp, { recursive: true, force: true });
});
