// The short case number customers and operators both quote. Case ids are UUIDs or seed names that
// share long prefixes, so the number is derived from the whole id (FNV-1a); it runs in the browser too.
export function caseNumber(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return `BB-${String((h >>> 0) % 1_000_000).padStart(6, '0')}`;
}
