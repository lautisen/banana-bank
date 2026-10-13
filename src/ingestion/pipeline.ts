import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { config } from '../config';
import type { Chunk, DocumentRecord } from '../types';
import { chunkDocument } from './chunker';
import { embedTexts, dimensions } from '../retrieval/embeddings';
import { replaceChunks, exportIndex } from '../retrieval/store';
export function documents(): DocumentRecord[] {
  return JSON.parse(fs.readFileSync(path.resolve('fixtures/documents/manifest.json'), 'utf8'));
}
export function readDocument(doc: DocumentRecord) {
  const root = path.resolve('fixtures/documents');
  const filename = path.resolve(root, doc.file);
  if (!filename.startsWith(root + path.sep)) throw new Error('Invalid document path.');
  let text = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
  if (filename.endsWith('.html'))
    text = text
      .replace(/<(script|style|template)[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|section|div|li|h[1-6])>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  // CSV notices hold one section per row ("section,content"); keep only the content, in order.
  if (filename.endsWith('.csv'))
    text = csvRows(text)
      .slice(1)
      .map((row) => row.at(-1))
      .join('\n\n');
  return text.trim();
}
function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  const endField = () => {
    row.push(field);
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') endField();
    else if (c === '\n') {
      endField();
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) {
    endField();
    rows.push(row);
  }
  return rows;
}
export async function ingest(onProgress: (value: string) => void = () => {}) {
  const docs = documents();
  const chunks: Chunk[] = docs.flatMap((doc) => chunkDocument(doc, readDocument(doc)));
  onProgress(`${docs.length} documents · ${chunks.length} chunks`);
  const vectors = await embedTexts(chunks.map((c) => c.text));
  const complete = chunks.map((c, i) => ({ ...c, vector: vectors[i] }));
  replaceChunks(complete, { model: config.embeddingModel, dimensions });
  onProgress('Index updated.');
  return {
    documents: docs.length,
    chunks: complete.length,
    model: config.embeddingModel,
    dimensions,
  };
}
export function saveInitialIndex() {
  fs.mkdirSync('fixtures/embeddings', { recursive: true });
  fs.writeFileSync('fixtures/embeddings/index.json.gz', gzipSync(JSON.stringify(exportIndex())));
}
