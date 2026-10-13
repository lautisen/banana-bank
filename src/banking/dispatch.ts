import { bankRequest, BankError } from './client';
import type { Operation, TransferInput } from '../types';

export type DispatchOutcome =
  | { kind: 'completed'; operation: Operation }
  | { kind: 'rejected'; status: number; error: string }
  | { kind: 'not_executed'; error: string }
  | { kind: 'unknown'; error: string };

const attempts = 3;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Sends one logical intent to the bank. The reference is fixed for the intent, so every retry is
// the same request from the bank's point of view: a commit whose response was lost comes back as
// a replay instead of a second transfer. A transport error or 5xx never proves a rejection, so
// after the last attempt the outcome is verified by reference before anything is reported.
export async function dispatchTransfer(
  userId: string,
  reference: string,
  input: TransferInput,
): Promise<DispatchOutcome> {
  let lastError = 'No response received from the bank.';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const operation = await bankRequest<Operation>(userId, '/v1/transfers', 'POST', {
        ...input,
        reference,
      });
      return { kind: 'completed', operation };
    } catch (e) {
      if (!(e instanceof BankError)) throw e;
      if (e.status < 500) return { kind: 'rejected', status: e.status, error: e.message };
      lastError = e.message;
      if (attempt < attempts - 1) await pause(200 * (attempt + 1));
    }
  }
  return verifyTransfer(userId, reference, lastError);
}

// Looks the reference up in the ledger: found means completed, 404 means the bank never recorded
// it, and any other failure leaves the outcome unknown (never reported as a failure).
export async function verifyTransfer(
  userId: string,
  reference: string,
  previousError = 'The bank did not confirm the operation.',
): Promise<DispatchOutcome> {
  try {
    const operation = await bankRequest<Operation>(
      userId,
      `/v1/operations/${encodeURIComponent(reference)}`,
    );
    return { kind: 'completed', operation };
  } catch (e) {
    if (e instanceof BankError && e.status === 404)
      return { kind: 'not_executed', error: previousError };
    return { kind: 'unknown', error: e instanceof Error ? e.message : previousError };
  }
}
