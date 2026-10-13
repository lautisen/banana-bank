import { bankRequest } from './client';
import type { Account, TransferInput } from '../types';

export type Contact = { id: string; userId: string; label: string; iban: string; name?: string };
export type TransferParties = { from: Account; to: { id: string; label: string; name: string } };
export type AuthorizationResult =
  { ok: true; parties: TransferParties } | { ok: false; code: string; error: string };

// Checks what the application can know before proposing: the source belongs to the session's
// customer, the destination exists and differs, and the current balance covers the amount.
// The bank remains authoritative and re-checks everything when the confirmed intent is sent.
export async function authorizeTransfer(
  userId: string,
  input: TransferInput,
): Promise<AuthorizationResult> {
  const [accounts, contacts] = await Promise.all([
    bankRequest<Account[]>(userId, '/v1/accounts'),
    bankRequest<Contact[]>(userId, '/v1/contacts'),
  ]);
  const from = accounts.find((a) => a.id === input.fromAccountId);
  if (!from)
    return {
      ok: false,
      code: 'forbidden_account',
      error: 'The source account does not belong to this customer.',
    };
  if (input.toAccountId === from.id)
    return { ok: false, code: 'same_account', error: 'Source and destination must differ.' };
  const own = accounts.find((a) => a.id === input.toAccountId);
  const contact = contacts.find((c) => c.id === input.toAccountId);
  if (!own && !contact)
    return {
      ok: false,
      code: 'unknown_destination',
      error: 'The destination account does not exist.',
    };
  if (from.balanceCents < input.amountCents)
    return {
      ok: false,
      code: 'insufficient_funds',
      error: `Insufficient funds: ${from.label} has ${(from.balanceCents / 100).toFixed(2)} EUR available.`,
    };
  const to = own
    ? { id: own.id, label: own.label, name: 'Your own account' }
    : { id: contact!.id, label: contact!.label, name: contact!.name || contact!.userId };
  return { ok: true, parties: { from, to } };
}
