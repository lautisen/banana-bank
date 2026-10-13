import { appDb } from '../db';
import { config } from '../config';
import { embedTexts } from './embeddings';
import { allChunks } from './store';
import { documents } from '../ingestion/pipeline';
import { sourceValidity } from '../agent/prompt';
import type { DocumentRecord, SearchResult } from '../types';

const perDocument = 2;
// Slots reserved for the customer's own products. A generic question ("my monthly fee") scores
// other products' fee documents just as high, so similarity alone can leave the customer's product
// out; the remaining slots stay open, so a question naming another product still finds it.
const ownProductSlots = 2;

// Products are the document id prefixes used by product documentation (aurora-fees-2026, ...).
export function documentProduct(documentId: string) {
  const match = /^(?:archive|notice)-([a-z]+)|^([a-z]+)-(?:fees|conditions|operations)-/.exec(
    documentId,
  );
  return match ? match[1] || match[2] : null;
}

// Every chunk carries its document's title, version and validity window (the index only stores
// them on a document's first chunk), so the agent can tell current terms from archived ones.
// Ranking keeps current sources first, admits at most one historical/future source, and caps
// chunks per document so one long document cannot crowd out the others.
// Ids in `pinned` are considered first (still subject to the same caps), then everything by score.
export function rankSources(scored: SearchResult[], limit: number, pinned = new Set<string>()) {
  const manifest = new Map<string, DocumentRecord>(documents().map((d) => [d.id, d]));
  const enriched = scored
    .map((s) => {
      const doc = manifest.get(s.documentId);
      const meta = doc
        ? { title: doc.title, version: doc.version, validFrom: doc.validFrom, validTo: doc.validTo }
        : {};
      const withMeta = { ...s, ...meta };
      return { ...withMeta, validity: sourceValidity(withMeta) } as SearchResult;
    })
    .sort((a, b) => b.score - a.score);
  const picked: SearchResult[] = [],
    perDoc = new Map<string, number>();
  let outOfDate = 0;
  const ordered = [
    ...enriched.filter((s) => pinned.has(s.id)),
    ...enriched.filter((s) => !pinned.has(s.id)),
  ];
  for (const s of ordered) {
    if (picked.length === limit) break;
    if ((perDoc.get(s.documentId) || 0) >= perDocument) continue;
    if (s.validity !== 'current' && outOfDate >= 1) continue;
    if (s.validity !== 'current') outOfDate++;
    perDoc.set(s.documentId, (perDoc.get(s.documentId) || 0) + 1);
    picked.push(s);
  }
  return picked.sort(
    (a, b) =>
      Number(a.validity !== 'current') - Number(b.validity !== 'current') || b.score - a.score,
  );
}

export async function searchDocuments(
  query: string,
  role = 'customer',
  limit = 5,
  products: string[] = [],
): Promise<SearchResult[]> {
  const meta = appDb().prepare('SELECT value FROM meta WHERE key=?').get('index-model') as
    { value: string } | undefined;
  if (!meta) throw new Error('No document index. Run npm run setup or npm run ingest.');
  if (meta.value !== config.embeddingModel)
    throw new Error('The model does not match the index. Re-ingest the documents.');
  const [queryVector] = await embedTexts([query]);
  const scored = allChunks()
    .filter((c) => role === 'operator' || c.audience === 'public')
    .map(({ vector, ...c }) => {
      if (vector!.length !== queryVector.length)
        throw new Error('Incompatible embedding dimensions.');
      const score = vector!.reduce((sum, v, i) => sum + v * queryVector[i], 0);
      return { ...c, score };
    });
  const pinned = scored
    .filter(
      (c) =>
        products.includes(documentProduct(c.documentId) || '') && sourceValidity(c) === 'current',
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, ownProductSlots)
    .map((c) => c.id);
  return rankSources(scored, limit, new Set(pinned));
}
