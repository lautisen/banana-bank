import { es } from "./thermometer";
import type { FrictionDecision, PurchaseIntent, ThermometerResult, UlisesRule, UserProfile } from "./types";

const inHours = (h: number, [from, to]: [number, number]) => (from <= to ? h >= from && h < to : h >= from || h < to);

/** Rules the user wrote "in cold" that apply to this payment. */
export function matchRules(rules: UlisesRule[], purchase: PurchaseIntent, thermo: ThermometerResult, profile: UserProfile): UlisesRule[] {
  const h = new Date(purchase.at).getHours();
  return rules.filter((r) => {
    if (!r.enabled) return false;
    const w = r.when;
    if (w.categories && !w.categories.includes(purchase.category)) return false;
    if (w.minAmount !== undefined && purchase.amount < w.minAmount) return false;
    if (w.hours && !inHours(h, w.hours)) return false;
    if (w.minScore !== undefined && thermo.score < w.minScore) return false;
    if (w.newBeneficiary) {
      const isNew = purchase.kind === "transfer" && !!purchase.beneficiary && !profile.knownBeneficiaries.includes(purchase.beneficiary);
      if (!isNew) return false;
    }
    return true;
  });
}

/** Facts no agent can argue with: shown at every friction level above zero. */
export function hardFacts(purchase: PurchaseIntent, thermo: ThermometerResult): string[] {
  const facts = [`Equivale a ${es(thermo.hoursOfWork)} horas de tu trabajo.`];
  if (thermo.cushionDaysAfter < thermo.daysToPayday) {
    facts.push(`Después de pagar te quedarían ${thermo.cushionDaysAfter} días de gasto normal y faltan ${thermo.daysToPayday} para la nómina.`);
  } else {
    facts.push(`Después de pagar te quedan ${thermo.cushionDaysAfter} días de gasto normal; la nómina llega en ${thermo.daysToPayday}.`);
  }
  if (purchase.kind === "transfer") facts.push("Una transferencia inmediata casi nunca se puede recuperar.");
  return facts;
}

/**
 * Adaptive friction: zero friction by default, and only as much as the moment needs.
 * The user's own rules outrank the system; scam risk outranks everything.
 */
export function decideFriction(
  purchase: PurchaseIntent,
  thermo: ThermometerResult,
  rules: UlisesRule[],
  profile: UserProfile,
): FrictionDecision {
  const matchedRules = matchRules(rules, purchase, thermo, profile);
  const facts = hardFacts(purchase, thermo);

  if (thermo.scamRisk) {
    return { level: 4, mode: "escudo_estafa", title: "Esto se parece a una estafa", matchedRules, facts };
  }
  // Rules that act (wait, move money, verify) take over the flow. A "question" rule rides along with
  // whatever mode the thermometer picks, so the user still gets the debate plus their own question.
  if (matchedRules.some((r) => r.action.type !== "pregunta")) {
    return { level: 3, mode: "regla_ulises", title: "Tu yo de antes te dejó un mensaje", matchedRules, facts };
  }
  if (thermo.level === "alto" || thermo.level === "critico") {
    return { level: 2, mode: "debate", title: "Escucha las dos versiones antes de decidir", matchedRules, facts };
  }
  if (thermo.level === "atencion") {
    return { level: 1, mode: "aviso", title: "Un segundo antes de pagar", matchedRules, facts };
  }
  return { level: 0, mode: "sin_friccion", title: "Adelante", matchedRules, facts: [] };
}
