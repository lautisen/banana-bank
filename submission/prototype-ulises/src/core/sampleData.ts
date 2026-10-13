import type { Category, Transaction, UlisesRule, UserProfile } from "./types";

/** Deterministic PRNG so the demo and the tests always see the same history. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_NOW = "2026-10-17T03:12:00";

export const demoProfile: UserProfile = {
  name: "Lucía",
  monthlyNetIncome: 1650,
  payday: 28,
  balance: 1240,
  monthlyWorkHours: 160,
  professionalCategories: [],
  knownBeneficiaries: ["ES21 0049 1500 0512 3456 7890", "Casero - Alquiler"],
};

interface Habit {
  category: Category;
  merchants: string[];
  perMonth: number;
  min: number;
  max: number;
  /** Typical local hours of the day. */
  hours: number[];
}

const HABITS: Habit[] = [
  { category: "supermercado", merchants: ["Mercadona", "Lidl", "Día"], perMonth: 9, min: 18, max: 75, hours: [10, 12, 18, 19, 20] },
  { category: "transporte", merchants: ["Metro", "Cabify", "Repsol"], perMonth: 8, min: 2, max: 45, hours: [8, 9, 18, 19] },
  { category: "restauracion", merchants: ["Bar Manolo", "Glovo", "Telepizza"], perMonth: 6, min: 9, max: 38, hours: [14, 15, 21, 22] },
  { category: "moda", merchants: ["Zara", "Primark", "Vinted"], perMonth: 2, min: 15, max: 60, hours: [17, 18, 19] },
  { category: "electronica", merchants: ["MediaMarkt", "PcComponentes"], perMonth: 0.4, min: 20, max: 90, hours: [17, 18] },
  { category: "ocio", merchants: ["Cines Yelmo", "Ticketmaster"], perMonth: 2, min: 8, max: 45, hours: [19, 20, 21] },
  { category: "suscripciones", merchants: ["Spotify", "Netflix"], perMonth: 2, min: 10, max: 14, hours: [9] },
  { category: "hogar", merchants: ["Iberdrola", "Ikea"], perMonth: 1.5, min: 30, max: 90, hours: [11, 17] },
];

/** About 90 days of a moderate, daytime spender, ending just before DEMO_NOW. */
export function buildDemoHistory(seed = 7, now = DEMO_NOW): Transaction[] {
  const rnd = mulberry32(seed);
  const end = new Date(now).getTime();
  const out: Transaction[] = [];
  let id = 0;
  for (const h of HABITS) {
    const count = Math.round(h.perMonth * 3);
    for (let i = 0; i < count; i++) {
      const daysAgo = 1 + Math.floor(rnd() * 89);
      const d = new Date(end - daysAgo * 86_400_000);
      d.setHours(h.hours[Math.floor(rnd() * h.hours.length)], Math.floor(rnd() * 60), 0, 0);
      out.push({
        id: `tx${++id}`,
        at: localIso(d),
        amount: Math.round((h.min + rnd() * (h.max - h.min)) * 100) / 100,
        merchant: h.merchants[Math.floor(rnd() * h.merchants.length)],
        category: h.category,
        kind: "card",
      });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/** Rules a user would plausibly write during onboarding, "in cold". */
export const defaultRules: UlisesRule[] = [
  {
    id: "noche",
    label: "Si compro de madrugada algo de más de 80 €, espérame 12 horas.",
    enabled: true,
    when: { minAmount: 80, hours: [0, 6] },
    action: { type: "esperar", hours: 12 },
  },
  {
    id: "transfer-nueva",
    label: "Antes de mandar dinero a una cuenta nueva, que me obligue a llamar a mi hermana Marta.",
    enabled: true,
    when: { newBeneficiary: true },
    action: { type: "verificar_contacto", contact: "Marta (hermana)" },
  },
  {
    id: "viaje",
    label: "Si el termómetro pasa de 60, pregúntame si esto me acerca o me aleja del viaje a Japón.",
    enabled: true,
    when: { minScore: 60 },
    action: { type: "pregunta", question: "¿Esto te acerca o te aleja del viaje a Japón?" },
  },
  {
    id: "apuestas",
    label: "Todo lo que intente gastar en apuestas, muévelo a mi hucha.",
    enabled: false,
    when: { categories: ["apuestas"] },
    action: { type: "mover_a_meta", goal: "Hucha Japón" },
  },
];
