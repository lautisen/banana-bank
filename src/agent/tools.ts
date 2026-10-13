import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FunctionTool } from 'openai/resources/responses/responses';
import { bankRequest } from '../banking/client';
import { transferMoney, operationStatus } from '../banking/actions';
import { searchDocuments } from '../retrieval/search';
import { appDb } from '../db';
import { HttpError } from '../auth';
import { person } from '../people';
import { recordEvent } from '../telemetry';
import { createRule, listRules, requestRuleRemoval } from '../ulises/service';
import { projectPurchase } from '../ulises/projection';
import type { ToolContext } from '../types';
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: 'string' };
const nullableInteger = { type: ['integer', 'null'] };
export const toolDefinitions: FunctionTool[] = [
  {
    type: 'function',
    name: 'list_accounts',
    description: "Get the current customer's accounts, balances, and available recipients.",
    parameters: object({}),
    strict: true,
  },
  {
    type: 'function',
    name: 'search_documents',
    description: "Search the bank's documentation for policies and procedures.",
    parameters: object({ query: string }),
    strict: true,
  },
  {
    type: 'function',
    name: 'transfer_money',
    description:
      'Prepare a transfer proposal between simulator accounts for the customer to review and confirm in the application. It never sends money by itself. Amounts are integer euro cents. Only call it once source, destination, amount and description are all known from the customer.',
    parameters: object({
      fromAccountId: string,
      toAccountId: string,
      amountCents: { type: 'integer' },
      concept: string,
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'operation_status',
    description:
      'Check the verified status of a transfer by its intentId or bank reference, re-checking the bank ledger when needed.',
    parameters: object({ reference: string }),
    strict: true,
  },
  {
    type: 'function',
    name: 'set_safety_rule',
    description:
      "Save a Ulises safety rule the customer asks for in their own words, e.g. 'if I ever send more than 300 euros to someone new, make me wait an hour'. Rules only add protection: they hold or flag future transfer proposals. Use the customer's wording in label. minAmountCents and the hours are null when the customer did not mention them; hoursFrom/hoursTo are local hours (Europe/Madrid), both null or both set. trustedContact is a person the customer wants to be reminded to call, or null.",
    parameters: object({
      label: string,
      minAmountCents: nullableInteger,
      onlyNewRecipients: { type: 'boolean' },
      hoursFrom: nullableInteger,
      hoursTo: nullableInteger,
      holdMinutes: { type: 'integer' },
      trustedContact: { type: ['string', 'null'] },
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'list_safety_rules',
    description: "List the customer's active Ulises safety rules, including any pending removal.",
    parameters: object({}),
    strict: true,
  },
  {
    type: 'function',
    name: 'remove_safety_rule',
    description:
      'Request the removal of a Ulises safety rule by id. Removal only takes effect after a delay (24 h by default); the rule keeps protecting the customer until then. Never suggest removing a rule to get a held transfer through.',
    parameters: object({ ruleId: string }),
    strict: true,
  },
  {
    type: 'function',
    name: 'project_purchase',
    description:
      "Project the customer's balance month by month if they buy something (12 months, or the whole instalment plan up to 60 months when they quote one): without buying, paying it all today, saving first, and paying in instalments when the customer quotes them. Uses their real balances and Ulises limits; the app shows a chart under your reply. Amounts are integer euro cents. Only pass figures the customer gave: monthlyCostCents (running costs such as insurance or fuel), upfrontCents, monthlyInstalmentCents and instalmentMonths are null when unknown; never invent prices, rates or instalments.",
    parameters: object({
      label: string,
      priceCents: { type: 'integer' },
      monthlyCostCents: nullableInteger,
      upfrontCents: nullableInteger,
      monthlyInstalmentCents: nullableInteger,
      instalmentMonths: nullableInteger,
    }),
    strict: true,
  },
  {
    type: 'function',
    name: 'request_human',
    description:
      'Open a human support case for this conversation, or add new information to the case already open. Only call it when the customer asks for a person or accepts an offer of human support.',
    parameters: object({ summary: string }),
    strict: true,
  },
];
export async function runTool(name: string, args: unknown, ctx: ToolContext): Promise<unknown> {
  const started = Date.now();
  recordEvent(ctx, 'tool.started', { tool: name, status: 'started', arguments: args });
  let result: unknown;
  try {
    switch (name) {
      case 'list_accounts':
        result = {
          accounts: await bankRequest(ctx.userId, '/v1/accounts'),
          contacts: await bankRequest(ctx.userId, '/v1/contacts'),
        };
        break;
      case 'search_documents':
        result = {
          sources: await searchDocuments(
            z.object({ query: z.string().max(2000) }).parse(args).query,
            'customer',
            5,
            ctx.products,
          ),
        };
        break;
      case 'transfer_money':
        result = await transferMoney(ctx, args);
        break;
      case 'operation_status':
        result = await operationStatus(
          ctx.userId,
          z.object({ reference: z.string().min(1).max(200) }).parse(args).reference,
        );
        break;
      case 'set_safety_rule':
        if (person(ctx.userId)?.role !== 'customer')
          throw new HttpError(403, 'A customer is required.');
        result = createRule(ctx, args);
        break;
      case 'list_safety_rules':
        result = { rules: listRules(ctx.userId) };
        break;
      case 'remove_safety_rule':
        result = requestRuleRemoval(
          ctx,
          z.object({ ruleId: z.string().min(1).max(100) }).parse(args).ruleId,
        );
        break;
      case 'project_purchase':
        if (person(ctx.userId)?.role !== 'customer')
          throw new HttpError(403, 'A customer is required.');
        result = await projectPurchase(ctx, args);
        break;
      case 'request_human': {
        if (!ctx.conversationId) throw new Error('A conversation is required to open a case.');
        const { summary } = z.object({ summary: z.string().min(1).max(2000) }).parse(args);
        const existing = appDb()
          .prepare('SELECT id FROM incidents WHERE conversation_id=? AND status=?')
          .get(ctx.conversationId, 'open') as { id: string } | undefined;
        const id = existing?.id || randomUUID(),
          now = new Date().toISOString();
        // A later request on an open case adds to its summary, so the operator sees every update.
        if (existing)
          appDb()
            .prepare('UPDATE incidents SET summary=summary||? WHERE id=?')
            .run(`\n\nUpdate ${now}: ${summary}`, id);
        else
          appDb()
            .prepare('INSERT INTO incidents VALUES(?,?,?,?,?,?)')
            .run(id, ctx.userId, ctx.conversationId, summary, 'open', now);
        result = { status: 'open', incidentId: id, updated: !!existing };
        break;
      }
      default:
        throw new Error('Unknown tool.');
    }
    recordEvent(ctx, 'tool.completed', {
      tool: name,
      status: 'completed',
      arguments: args,
      output: result,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Tool error';
    recordEvent(ctx, 'tool.failed', {
      tool: name,
      status: 'failed',
      arguments: args,
      error,
      durationMs: Date.now() - started,
    });
    return { status: e instanceof HttpError && e.status === 409 ? 'conflict' : 'failed', error };
  }
}
