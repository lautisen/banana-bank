import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { appDb } from '../db';
import { bankRequest } from '../banking/client';
import type { Account, ToolContext } from '../types';
import { eur } from './engine';
import { profileView, type Movement } from './profile';

// "Is buying this a good idea?": Ulises tells the customer how their next months would look under
// each way of paying, month by month. The arithmetic is deterministic and uses only the customer's
// own figures (bank balances, their Ulises answers, the price and instalments they quote). The
// model narrates the result; it never computes or invents a number, a rate or a product.

export type ProjectionPoint = { month: string; balanceCents: number };
export type ProjectionOutcome = 'comfortable' | 'tight' | 'below_cushion' | 'negative';
export type ProjectionScenario = {
  id: 'without' | 'pay_now' | 'save_first' | 'instalments';
  label: string;
  points: ProjectionPoint[];
  // Index into points of the month the purchase is paid (null: not within the horizon).
  buyIndex: number | null;
  lowestCents: number;
  lowestMonth: string;
  firstBelowCushion: string | null;
  endCents: number;
  outcome: ProjectionOutcome | null;
  note: string | null;
};
export type ProjectionInput = {
  label: string;
  priceCents: number;
  monthlyCostCents: number;
  upfrontCents: number | null;
  monthlyInstalmentCents: number | null;
  instalmentMonths: number | null;
  balanceCents: number;
  monthlyIncomeCents: number;
  monthlySpendCents: number;
  cushionCents: number;
  start: Date;
  months?: number;
};
export type Projection = {
  label: string;
  months: number;
  instalmentMonths: number | null;
  priceCents: number;
  monthlyCostCents: number;
  balanceCents: number;
  monthlyIncomeCents: number;
  monthlySpendCents: number;
  monthlySurplusCents: number;
  cushionCents: number;
  scenarios: ProjectionScenario[];
  facts: string[];
};

// The view covers a year, or the whole instalment plan when the customer quotes a longer one, so
// they see the month the last instalment is paid. Five years keeps the chart readable.
export const maxProjectionMonths = 60;
export const projectionMonths = (instalmentMonths: number | null) =>
  Math.min(maxProjectionMonths, Math.max(12, instalmentMonths ?? 0));

const monthLabel = (start: Date, offset: number) =>
  new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'Europe/Madrid' })
    .format(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 15)))
    .replace(' ', ' ’');

function scenario(
  id: ProjectionScenario['id'],
  label: string,
  start: Date,
  months: number,
  cushion: number,
  spend: number,
  flow: (m: number) => number,
  opening: number,
  buyIndex: number | null,
  note: string | null = null,
): ProjectionScenario {
  const points: ProjectionPoint[] = [{ month: 'Today', balanceCents: opening }];
  for (let m = 1; m <= months; m++)
    points.push({
      month: monthLabel(start, m),
      balanceCents: points[m - 1].balanceCents + flow(m),
    });
  const lowest = points.reduce((a, p) => (p.balanceCents < a.balanceCents ? p : a), points[0]);
  const below = points.find((p) => p.balanceCents < cushion);
  const outcome: ProjectionOutcome | null =
    id === 'without'
      ? null
      : lowest.balanceCents < 0
        ? 'negative'
        : lowest.balanceCents < cushion
          ? 'below_cushion'
          : lowest.balanceCents < cushion + spend
            ? 'tight'
            : 'comfortable';
  return {
    id,
    label,
    points,
    buyIndex,
    lowestCents: lowest.balanceCents,
    lowestMonth: lowest.month,
    firstBelowCushion: below?.month ?? null,
    endCents: points[months].balanceCents,
    outcome,
    note,
  };
}

export function project(i: ProjectionInput): Projection {
  const months = i.months ?? projectionMonths(i.monthlyInstalmentCents ? i.instalmentMonths : null);
  const surplus = i.monthlyIncomeCents - i.monthlySpendCents;
  const s = (
    id: ProjectionScenario['id'],
    label: string,
    flow: (m: number) => number,
    opening: number,
    buyIndex: number | null,
    note: string | null = null,
  ) =>
    scenario(
      id,
      label,
      i.start,
      months,
      i.cushionCents,
      i.monthlySpendCents,
      flow,
      opening,
      buyIndex,
      note,
    );
  const scenarios: ProjectionScenario[] = [
    s('without', 'Without buying it', () => surplus, i.balanceCents, null),
    s(
      'pay_now',
      'Pay it all today',
      () => surplus - i.monthlyCostCents,
      i.balanceCents - i.priceCents,
      0,
    ),
  ];
  // Saving first only differs from paying today when paying today breaks the cushion.
  if (i.balanceCents - i.priceCents < i.cushionCents) {
    const gap = i.priceCents + i.cushionCents - i.balanceCents;
    const n = surplus > 0 ? Math.ceil(gap / surplus) : null;
    if (n !== null && n <= months)
      scenarios.push(
        s(
          'save_first',
          `Save first, buy in ${n} month${n === 1 ? '' : 's'}`,
          (m) => surplus - (m === n ? i.priceCents : 0) - (m > n ? i.monthlyCostCents : 0),
          i.balanceCents,
          n,
        ),
      );
    else
      scenarios.push(
        s(
          'save_first',
          'Save first',
          () => surplus,
          i.balanceCents,
          null,
          n === null
            ? 'With your current income and spending nothing is left over each month, so saving up does not get you there.'
            : `Saving ${eur(surplus)} a month, you would reach the price and keep your cushion in about ${n} months, beyond this ${months}-month view.`,
        ),
      );
  }
  if (i.monthlyInstalmentCents && i.instalmentMonths) {
    const upfront = i.upfrontCents ?? 0;
    const total = upfront + i.monthlyInstalmentCents * i.instalmentMonths;
    scenarios.push(
      s(
        'instalments',
        `${upfront ? `${eur(upfront)} down + ` : ''}${i.instalmentMonths} × ${eur(i.monthlyInstalmentCents)}`,
        (m) =>
          surplus - i.monthlyCostCents - (m <= i.instalmentMonths! ? i.monthlyInstalmentCents! : 0),
        i.balanceCents - upfront,
        0,
        [
          total > i.priceCents
            ? `You would pay ${eur(total)} in total, ${eur(total - i.priceCents)} more than the price.`
            : `You would pay ${eur(total)} in total.`,
          i.instalmentMonths > months
            ? `The plan runs ${i.instalmentMonths} months; this view shows the first ${months}.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      ),
    );
  }
  const facts = [
    `The price is ${(i.priceCents / Math.max(1, i.monthlyIncomeCents)).toFixed(1)} months of your income.`,
    `You have ${eur(i.balanceCents)} across your accounts and keep about ${eur(Math.max(0, surplus))} a month after spending.`,
  ];
  if (i.monthlyCostCents)
    facts.push(
      `Running costs of ${eur(i.monthlyCostCents)} a month are ${eur(i.monthlyCostCents * 12)} a year on top of the price.`,
    );
  return {
    label: i.label,
    months,
    instalmentMonths: i.monthlyInstalmentCents ? i.instalmentMonths : null,
    priceCents: i.priceCents,
    monthlyCostCents: i.monthlyCostCents,
    balanceCents: i.balanceCents,
    monthlyIncomeCents: i.monthlyIncomeCents,
    monthlySpendCents: i.monthlySpendCents,
    monthlySurplusCents: surplus,
    cushionCents: i.cushionCents,
    scenarios,
    facts,
  };
}

export const projectionArgsSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    priceCents: z.number().int().positive().max(100_000_000),
    monthlyCostCents: z.number().int().min(0).max(10_000_000).nullable(),
    upfrontCents: z.number().int().min(0).max(100_000_000).nullable(),
    monthlyInstalmentCents: z.number().int().positive().max(10_000_000).nullable(),
    instalmentMonths: z.number().int().min(1).max(480).nullable(),
  })
  .strict();

export async function projectPurchase(ctx: ToolContext, args: unknown) {
  const a = projectionArgsSchema.parse(args);
  const [accounts, movements] = await Promise.all([
    bankRequest<Account[]>(ctx.userId, '/v1/accounts'),
    bankRequest<Movement[]>(ctx.userId, '/v1/movements'),
  ]);
  const profile = profileView(ctx.userId, movements);
  const { monthlyIncomeCents: income, monthlySpendCents: spend } = profile.effective;
  if (!income || !spend)
    return {
      status: 'needs_figures',
      message:
        'Ulises needs the customer’s monthly income and spending to project this. Ask for both, or suggest the Ulises check in the app.',
    };
  const result = project({
    ...a,
    monthlyCostCents: a.monthlyCostCents ?? 0,
    balanceCents: accounts.reduce((t, x) => t + x.balanceCents, 0),
    monthlyIncomeCents: income,
    monthlySpendCents: spend,
    cushionCents: profile.effective.cushionCents,
    start: new Date(),
  });
  const data = {
    ...result,
    assumptions: [
      ...profile.assumptions,
      ...(a.monthlyCostCents === null
        ? ['No running costs included; the customer did not give them.']
        : []),
      'Income and spending are assumed to stay as they are; nothing here includes interest or rates.',
    ],
    limitsSource: profile.source,
  };
  // Stored whole as the run's event (not through recordEvent, which may truncate): the conversation
  // reads it back to draw the chart under the reply, and operators see the same record.
  const id = randomUUID();
  appDb()
    .prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)')
    .run(
      id,
      ctx.runId,
      ctx.userId,
      ctx.conversationId,
      'ulises.projected',
      JSON.stringify({
        intentId: ctx.intentId,
        status: 'projected',
        label: a.label,
        projection: data,
      }),
      new Date().toISOString(),
    );
  return {
    status: 'projected',
    projectionId: id,
    // The chart is shown under the assistant's reply; the model narrates from these numbers.
    ...data,
    // Long plans are narrated quarter by quarter; the chart keeps every month.
    scenarios: data.scenarios.map(({ points, ...x }) => ({
      ...x,
      balanceByMonth: points
        .filter((_, m) => data.months <= 12 || m % 3 === 0 || m === data.months)
        .map((p) => `${p.month}: ${eur(p.balanceCents)}`)
        .join(' · '),
    })),
  };
}
