import { dailySpend, daysToPayday } from "./thermometer";
import type { Transaction, UserProfile } from "./types";

export interface AccountSummary {
  saldo_eur: number;
  ingresos_netos_mes_eur: number;
  dias_hasta_nomina: number;
  gasto_medio_diario_eur: number;
  dias_de_colchon: number;
  gasto_30_dias_por_categoria_eur: Record<string, number>;
  gasto_30_dias_total_eur: number;
  ultimos_pagos: { fecha: string; comercio: string; importe_eur: number }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pre-computed figures the chat may quote. The LLM never does arithmetic over raw transactions:
 * if a number is not here, the output guardrail rejects it.
 */
export function summarizeAccount(profile: UserProfile, history: Transaction[], now: string): AccountSummary {
  const at = new Date(now);
  const from = at.getTime() - 30 * 86_400_000;
  const recent = history.filter((t) => {
    const ts = new Date(t.at).getTime();
    return ts >= from && ts < at.getTime();
  });
  const byCat: Record<string, number> = {};
  for (const t of recent) byCat[t.category] = r2((byCat[t.category] ?? 0) + t.amount);
  const perDay = dailySpend(history, at);
  return {
    saldo_eur: profile.balance,
    ingresos_netos_mes_eur: profile.monthlyNetIncome,
    dias_hasta_nomina: daysToPayday(at, profile.payday),
    gasto_medio_diario_eur: r2(perDay),
    dias_de_colchon: Math.floor(profile.balance / perDay),
    gasto_30_dias_por_categoria_eur: byCat,
    gasto_30_dias_total_eur: r2(recent.reduce((a, t) => a + t.amount, 0)),
    ultimos_pagos: [...recent]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 5)
      .map((t) => ({ fecha: t.at.slice(0, 10), comercio: t.merchant, importe_eur: t.amount })),
  };
}
