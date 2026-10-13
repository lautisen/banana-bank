import { createHash } from 'node:crypto';
import type { Chunk, DocumentRecord } from '../types';

const maxChars = 1200;
const targetChars = 900;

// Splits a section that is too long at paragraph, then sentence boundaries, never inside a word.
function splitLong(body: string): string[] {
  if (body.length <= maxChars) return [body];
  const units = body
    .split(/\n{2,}/)
    .flatMap((p) => (p.length <= maxChars ? [p] : p.split(/(?<=[.!?])\s+/)));
  const parts: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > targetChars) {
      parts.push(current);
      current = unit;
    } else current = current ? `${current}\n\n${unit}` : unit;
  }
  if (current) parts.push(current);
  return parts;
}

// One chunk per document section (a "#" heading starts a section), so a fee stays together with its
// waiver and exceptions. Every chunk starts with the document's title, version and validity, which
// both the embedding and the model see; the metadata columns are filled on every chunk too.
export function chunkDocument(doc: DocumentRecord, text: string): Chunk[] {
  const header = `${doc.title} (${doc.id} v${doc.version}, valid from ${doc.validFrom}${doc.validTo ? ` to ${doc.validTo}` : ''})`;
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of text.split('\n')) {
    if (/^#{1,6}\s/.test(line.trim()) && current.join('').trim()) {
      sections.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.join('').trim()) sections.push(current.join('\n').trim());
  const chunks: Chunk[] = [];
  sections.forEach((section, s) => {
    const heading = /^#{1,6}\s/.test(section) ? section.split('\n')[0].trim() : '';
    const body = heading ? section.slice(section.indexOf('\n') + 1).trim() : section;
    splitLong(body || heading).forEach((part, p) => {
      const lines = [header];
      if (heading && part !== heading) lines.push(heading);
      lines.push(part);
      const chunkText = lines.join('\n');
      chunks.push({
        id: createHash('sha256')
          .update(`${doc.id}:${s}:${p}:${chunkText}`)
          .digest('hex')
          .slice(0, 24),
        documentId: doc.id,
        text: chunkText,
        title: doc.title,
        version: doc.version,
        validFrom: doc.validFrom,
        validTo: doc.validTo,
        audience: doc.audience,
      });
    });
  });
  return chunks;
}
