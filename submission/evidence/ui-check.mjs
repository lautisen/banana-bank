// Drives the real UI: manual transfer under lost-response, proposal card, confirm, operator case.
// Usage: PW_PATH=<playwright package dir> node ui-check.mjs <screenshot dir>  (needs `npm run dev`)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH);
const out = process.argv[2];
const admin = { Authorization: 'Bearer banana-local-admin', 'Content-Type': 'application/json' };
const snapshot = async () => (await fetch('http://127.0.0.1:4001/admin/snapshot', { headers: admin })).json();
await fetch('http://127.0.0.1:4001/admin/scenario', {
  method: 'POST',
  headers: admin,
  body: JSON.stringify({ profile: 'lost-response' }),
});
const before = await snapshot();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://127.0.0.1:3000');
await page.getByText('Hello, Lucía').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /Transfers/ }).click();
await page.locator('select').nth(1).selectOption('acc-lucia');
await page.locator('select').nth(2).selectOption('acc-bruno');
await page.getByLabel('Amount in euros').fill('42.50');
await page.getByPlaceholder('What is this transfer for?').fill('Concert tickets');
await page.getByRole('button', { name: /Send transfer/ }).click();
await page.getByText('Review before sending').waitFor();
const proposed = await snapshot();
await page.screenshot({ path: `${out}/1-proposal.png`, fullPage: true });
await page.getByRole('button', { name: 'Confirm and send' }).click();
await page.getByText(/Transfer completed/).waitFor({ timeout: 20000 });
await page.screenshot({ path: `${out}/2-confirmed.png`, fullPage: true });
const after = await snapshot();
const count = (s) => s.operations.filter((o) => o.concept === 'Concert tickets').length;
const lucia = (s) => s.accounts.find((a) => a.id === 'acc-lucia').balanceCents;
console.log(JSON.stringify({
  scenario: after.scenario.profile,
  opsAfterProposal: count(proposed),
  opsAfterConfirm: count(after),
  luciaDebitCents: lucia(before) - lucia(after),
}));
await page.locator('select[aria-label="Switch person"]').selectOption('marta');
await page.getByText('Every case, a person.').waitFor();
await page.locator('.case-item', { hasText: 'Lucía' }).filter({ hasText: 'dinner' }).click();
await page.getByText('Gaps and discrepancies').waitFor();
await page.screenshot({ path: `${out}/3-operator-case-lucia.png`, fullPage: true });
console.log((await page.locator('.case-detail').innerText()).slice(0, 1500));
await browser.close();
