import { appDb } from '../db';
import { bankRequest } from '../banking/client';
import { recentIntents } from '../banking/actions';
import { documents } from '../ingestion/pipeline';
import { documentProduct } from '../retrieval/search';
import { sourceValidity } from './prompt';
import type { Account } from '../types';
import { profileView, type Movement } from '../ulises/profile';
import { eur } from '../ulises/engine';
import type { Contact } from '../banking/authorization';

// Bounds keep the profile a fixed size however long the customer's history is: older activity
// stays in the application database and is reached through tools, not pasted into every prompt.
const recentConversations = 5;
const recentTransfers = 5;
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

export type CustomerContext = { products: string[]; text: string };

// The customer profile the model reads before answering, built on every turn from authoritative
// sources (bank accounts and contacts, application records) so it is never stale. Nothing here is
// precomputed or summarised by a model.
export async function customerContext(
  userId: string,
  conversationId: string,
): Promise<CustomerContext> {
  const db = appDb(),
    lines: string[] = [];
  const known = new Set(
    documents()
      .map((d) => documentProduct(d.id))
      .filter(Boolean) as string[],
  );
  let products: string[] = [];
  try {
    const [accounts, contacts] = await Promise.all([
      bankRequest<Account[]>(userId, '/v1/accounts'),
      bankRequest<Contact[]>(userId, '/v1/contacts'),
    ]);
    products = [
      ...new Set(
        accounts.map((a) => a.label.split(/\s+/)[0].toLowerCase()).filter((p) => known.has(p)),
      ),
    ];
    lines.push(
      `Accounts (bank, read ${new Date().toISOString()}): ${accounts.length === 1 ? 'exactly one account' : `${accounts.length} accounts`}`,
      ...accounts.map(
        (a) =>
          `- ${a.id}: ${a.label}, IBAN ending ${a.iban.slice(-4)}, balance ${(a.balanceCents / 100).toFixed(2)} EUR`,
      ),
      `Recipients: ${contacts.map((c) => `${c.id} (${c.name || c.userId}, ${c.label})`).join('; ') || 'none'}`,
    );
  } catch {
    lines.push('Accounts: the bank could not be reached for this profile; use list_accounts.');
  }
  try {
    const u = profileView(userId, await bankRequest<Movement[]>(userId, '/v1/movements'));
    const e = u.effective;
    lines.push(
      `Ulises limits (${u.source === 'customer' ? `set by the customer in the Ulises check on ${u.completedAt!.slice(0, 10)}` : 'defaults: the customer has not done the Ulises check'}): safety cushion ${eur(e.cushionCents)}, big payment from ${eur(e.bigPaymentCents)}, monthly income ${e.monthlyIncomeCents ? eur(e.monthlyIncomeCents) : 'unknown'}, monthly spending ${e.monthlySpendCents ? eur(e.monthlySpendCents) : 'unknown'}${u.pending ? `; looser limits requested, effective ${u.pending.effectiveAt}` : ''}.`,
    );
  } catch {
    lines.push('Ulises limits: could not be read for this turn.');
  }
  const productDocs = documents().filter(
    (d) =>
      d.audience === 'public' &&
      products.includes(documentProduct(d.id) || '') &&
      sourceValidity(d) === 'current',
  );
  lines.push(
    `Products held: ${products.join(', ') || 'unknown'}. When the customer says "my account" or "my fee", they mean these products unless they name another one.`,
    `Current documentation for these products: ${productDocs.map((d) => `${d.id} v${d.version}`).join(', ') || 'none'}`,
  );
  const cases = db
    .prepare(
      "SELECT id,summary,created_at FROM incidents WHERE user_id=? AND status='open' ORDER BY created_at DESC LIMIT 3",
    )
    .all(userId) as { id: string; summary: string; created_at: string }[];
  lines.push(
    `Open support cases: ${cases.length ? '' : 'none'}`,
    ...cases.map((c) => `- ${c.id} (opened ${c.created_at.slice(0, 10)}): ${clip(c.summary, 240)}`),
  );
  const transfers = recentIntents(userId).slice(0, recentTransfers);
  lines.push(
    `Recent transfers (all conversations): ${transfers.length ? '' : 'none'}`,
    ...transfers.map((t) => {
      const p = t.payload as { amountCents: number; toAccountId: string; concept: string };
      return `- ${t.intentId}: ${(p.amountCents / 100).toFixed(2)} EUR to ${p.toAccountId} ("${clip(p.concept, 60)}"), status ${t.status}`;
    }),
  );
  const previous = db
    .prepare(
      `SELECT c.title, c.created_at,
         (SELECT content FROM messages m WHERE m.conversation_id=c.id AND m.role='user'
          ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_question
       FROM conversations c WHERE c.user_id=? AND c.id<>? ORDER BY c.created_at DESC LIMIT ?`,
    )
    .all(userId, conversationId, recentConversations) as {
    title: string;
    created_at: string;
    last_question: string | null;
  }[];
  lines.push(
    `Previous conversations (latest ${recentConversations}; older ones are not shown): ${previous.length ? '' : 'none'}`,
    ...previous.map(
      (c) =>
        `- ${c.created_at.slice(0, 10)} "${clip(c.title, 60)}"${c.last_question ? `, last question: "${clip(c.last_question, 160)}"` : ''}`,
    ),
  );
  return { products, text: lines.join('\n') };
}
