import { pressureScore } from "./darkPatterns";
import type {
  Category,
  Contribution,
  DarkPatternFinding,
  PurchaseIntent,
  ThermometerLevel,
  ThermometerResult,
  Transaction,
  UserProfile,
} from "./types";

const RISKY: Category[] = ["apuestas", "cripto", "flash_sales", "gaming"];
const SCAM_WORDS =
  /(cuenta segura|cuenta de seguridad|su banco|tu banco|urgente|hacienda|policia|bloquead|codigo|inversion garantizada|rentabilidad garantizada|herencia|premio|aduana|hijo|mama|papa|movil nuevo)/;
const DAY_MS = 86_400_000;

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** es-ES decimal comma, so the UI and the LLM data read naturally. */
export const es = (n: number, decimals = 1) => n.toFixed(decimals).replace(".", ",");

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export function daysToPayday(at: Date, payday: number): number {
  const next = new Date(at.getFullYear(), at.getMonth(), payday);
  if (next.getTime() <= at.getTime()) next.setMonth(next.getMonth() + 1);
  return Math.max(1, Math.ceil((next.getTime() - at.getTime()) / DAY_MS));
}

/** Average daily outflow over the 30 days before `at`, excluding the purchase itself. */
export function dailySpend(history: Transaction[], at: Date): number {
  const from = at.getTime() - 30 * DAY_MS;
  const total = history
    .filter((t) => {
      const ts = new Date(t.at).getTime();
      return ts >= from && ts < at.getTime();
    })
    .reduce((acc, t) => acc + t.amount, 0);
  return Math.max(1, total / 30);
}

export function levelFor(score: number): ThermometerLevel {
  if (score < 35) return "calma";
  if (score < 55) return "atencion";
  if (score < 75) return "alto";
  return "critico";
}

/**
 * Impulse thermometer: a 0-100 score of how much pressure (internal or external) surrounds a payment.
 * Every point is traceable to a named signal so the UI can always explain why it moved.
 */
export function measure(
  purchase: PurchaseIntent,
  profile: UserProfile,
  history: Transaction[],
  pagePatterns: DarkPatternFinding[] = [],
): ThermometerResult {
  const at = new Date(purchase.at);
  const contributions: Contribution[] = [];
  const add = (signal: string, points: number, detail: string) => {
    if (points > 0) contributions.push({ signal, points, detail });
  };
  const isProfessional = profile.professionalCategories.includes(purchase.category);

  // 1. Deviation from the user's own pattern in this category.
  if (!isProfessional && purchase.kind === "card") {
    const sameCat = history.filter((t) => t.category === purchase.category).map((t) => t.amount);
    const reference = sameCat.length >= 3 ? median(sameCat) : median(history.filter((t) => t.kind === "card").map((t) => t.amount));
    const ratio = reference > 0 ? purchase.amount / reference : 1;
    const label = sameCat.length >= 3 ? `tu gasto típico en ${purchase.category}` : "tu compra típica";
    if (ratio > 6) add("Desvío de tu patrón", 20, `${es(ratio)}× ${label} (${reference.toFixed(0)} €)`);
    else if (ratio > 3) add("Desvío de tu patrón", 14, `${es(ratio)}× ${label} (${reference.toFixed(0)} €)`);
    else if (ratio > 1.5) add("Desvío de tu patrón", 8, `${es(ratio)}× ${label} (${reference.toFixed(0)} €)`);
  }

  // 2. Share of available balance.
  const share = profile.balance > 0 ? purchase.amount / profile.balance : 1;
  if (share > 0.5) add("Peso sobre tu saldo", 20, `${Math.round(share * 100)} % de lo que tienes ahora`);
  else if (share > 0.3) add("Peso sobre tu saldo", 14, `${Math.round(share * 100)} % de lo que tienes ahora`);
  else if (share > 0.15) add("Peso sobre tu saldo", 7, `${Math.round(share * 100)} % de lo que tienes ahora`);

  // 3. Liquidity: does the cushion reach payday?
  const dtp = daysToPayday(at, profile.payday);
  const perDay = dailySpend(history, at);
  const cushion = Math.max(0, (profile.balance - purchase.amount) / perDay);
  if (cushion < dtp) add("No llegas a la nómina", 15, `te quedarían ${cushion.toFixed(0)} días de gasto y faltan ${dtp} para cobrar`);
  else if (cushion < dtp + 5) add("Llegas muy justo", 7, `margen de ${(cushion - dtp).toFixed(0)} días tras la nómina`);

  // 4. Velocity: several payments in the last hour.
  const lastHour = history.filter((t) => {
    const d = at.getTime() - new Date(t.at).getTime();
    return d >= 0 && d <= 3_600_000;
  }).length;
  if (lastHour >= 3) add("Compras en cadena", 12, `${lastHour} pagos en la última hora`);
  else if (lastHour === 2) add("Compras en cadena", 6, `${lastHour} pagos en la última hora`);

  // 5. Unusual hour *for this user*, not in absolute terms.
  if (history.length >= 30) {
    const h = at.getHours();
    const near = history.filter((t) => {
      const th = new Date(t.at).getHours();
      const diff = Math.min(Math.abs(th - h), 24 - Math.abs(th - h));
      return diff <= 1;
    }).length;
    if (near / history.length < 0.03) add("Hora poco habitual para ti", 10, `casi nunca pagas a las ${String(h).padStart(2, "0")}:00`);
  }

  // 6. Categories built around impulse.
  if (RISKY.includes(purchase.category)) add("Categoría de impulso", 10, `${purchase.category} está diseñada para decidir rápido`);

  // 7. External pressure from the page (dark patterns).
  const pressure = pressureScore(pagePatterns);
  const kinds = new Set(pagePatterns.map((f) => f.kind)).size;
  if (pressure > 0) add("Presión de la web", pressure, `${kinds} ${kinds === 1 ? "técnica" : "técnicas"} de manipulación en la página`);

  // 8. Authorised push payment scam pattern.
  let scamRisk = false;
  if (purchase.kind === "transfer") {
    const isNew = !!purchase.beneficiary && !profile.knownBeneficiaries.includes(purchase.beneficiary);
    const round = purchase.amount >= 300 && purchase.amount % 100 === 0;
    const words = purchase.context ? SCAM_WORDS.test(norm(purchase.context)) : false;
    if (isNew) add("Beneficiario nuevo", 15, "nunca has enviado dinero a esta cuenta");
    if (round) add("Importe redondo", 8, "las estafas suelen pedir cifras redondas");
    if (words) add("Lenguaje de estafa", 15, "el concepto o la conversación usa frases típicas de fraude");
    scamRisk = isNew && (round || words);
  }

  let score = Math.min(100, contributions.reduce((a, c) => a + c.points, 0));
  if (scamRisk) score = Math.max(score, 80);
  if (isProfessional && score < 35) {
    contributions.push({ signal: "Categoría profesional", points: 0, detail: "la marcaste como gasto de trabajo: no sube el termómetro" });
  }

  return {
    score,
    level: levelFor(score),
    contributions: contributions.sort((a, b) => b.points - a.points),
    scamRisk,
    cushionDaysAfter: Math.round(cushion),
    daysToPayday: dtp,
    hoursOfWork: Math.round((purchase.amount / (profile.monthlyNetIncome / profile.monthlyWorkHours)) * 10) / 10,
  };
}
