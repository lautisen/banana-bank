// Accepts "12.50", "12,50", "1,234.56", "1.234,56" and "1.234" (three digits after a single
// separator are thousands). Thousands and decimals must use different separators. Returns null
// when the amount is unclear, so the form asks again instead of guessing.
export function parseAmountCents(value: string): number | null {
  const v = value.replace(/\s|€|EUR/gi, '');
  const match = /^(\d{1,3}(?:([.,])\d{3})*|\d+)(?:([.,])(\d{1,2}))?$/.exec(v);
  if (!match || (match[2] && match[2] === match[3])) return null;
  return Number(match[1].replace(/[.,]/g, '')) * 100 + Number((match[4] || '').padEnd(2, '0'));
}
