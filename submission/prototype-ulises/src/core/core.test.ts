import { describe, expect, it } from "vitest";
import { detectDarkPatterns, pressureScore } from "./darkPatterns";
import { DEMO_NOW, buildDemoHistory, defaultRules, demoProfile } from "./sampleData";
import { daysToPayday, measure } from "./thermometer";
import { decideFriction } from "./ulises";
import type { PurchaseIntent } from "./types";

const history = buildDemoHistory();

const shopPage = [
  { text: "¡Oferta flash! Termina en 04:59", isTimer: true, ref: "timer" },
  { text: "Solo quedan 2 unidades", ref: "stock" },
  { text: "17 personas lo están viendo ahora", ref: "social" },
  { text: "Seguro de protección premium +29,99 €", checked: true, ref: "addon" },
  { text: "No, prefiero pagar más y no proteger mi compra", ref: "shame" },
  { text: "Gastos de gestión 4,99 €", ref: "fee" },
  { text: "Añadir al carrito", ref: "cta" },
];

describe("escudo de dark patterns", () => {
  it("detecta cada técnica de la tienda demo", () => {
    const kinds = new Set(detectDarkPatterns(shopPage).map((f) => f.kind));
    expect(kinds).toEqual(
      new Set(["falsa_urgencia", "falsa_escasez", "presion_social", "preseleccion", "confirmshaming", "coste_oculto"]),
    );
  });

  it("no marca una página limpia", () => {
    expect(detectDarkPatterns([{ text: "Zapatillas running 129 €" }, { text: "Envío gratis en 48 h" }, { text: "Añadir al carrito" }])).toEqual([]);
  });

  it("un extra NO marcado no es preselección", () => {
    expect(detectDarkPatterns([{ text: "Seguro de protección +29,99 €", checked: false }])).toEqual([]);
  });

  it("limita la presión externa a 25 puntos", () => {
    expect(pressureScore(detectDarkPatterns(shopPage))).toBe(25);
  });
});

describe("termómetro", () => {
  it("una compra de supermercado normal a media tarde está en calma", () => {
    const p: PurchaseIntent = { amount: 42, merchant: "Mercadona", category: "supermercado", kind: "card", at: "2026-10-17T18:30:00" };
    const r = measure(p, demoProfile, history);
    expect(r.level).toBe("calma");
  });

  it("un reloj de 1.000 € de madrugada con presión de la web es crítico", () => {
    const p: PurchaseIntent = { amount: 999, merchant: "LuxTime", category: "moda", kind: "card", at: DEMO_NOW };
    const r = measure(p, demoProfile, history, detectDarkPatterns(shopPage));
    expect(r.level).toBe("critico");
    expect(r.contributions.map((c) => c.signal)).toEqual(
      expect.arrayContaining(["Desvío de tu patrón", "Peso sobre tu saldo", "Hora poco habitual para ti", "Presión de la web"]),
    );
  });

  it("una transferencia redonda a cuenta nueva con lenguaje de estafa activa el riesgo de estafa", () => {
    const p: PurchaseIntent = {
      amount: 2000, merchant: "Transferencia", category: "transferencia", kind: "transfer", at: "2026-10-17T11:00:00",
      beneficiary: "ES00 9999 0000 1111 2222 3333", context: "Me llaman de mi banco: mover el dinero a una cuenta segura urgente",
    };
    const r = measure(p, demoProfile, history);
    expect(r.scamRisk).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it("el alquiler al casero conocido no es estafa", () => {
    const p: PurchaseIntent = { amount: 600, merchant: "Transferencia", category: "transferencia", kind: "transfer", at: "2026-10-01T10:00:00", beneficiary: "Casero - Alquiler" };
    expect(measure(p, demoProfile, history).scamRisk).toBe(false);
  });

  it("las categorías profesionales no suben el termómetro por desvío", () => {
    const pro = { ...demoProfile, professionalCategories: ["electronica" as const] };
    const p: PurchaseIntent = { amount: 180, merchant: "PcComponentes", category: "electronica", kind: "card", at: "2026-10-17T12:00:00" };
    const r = measure(p, pro, history);
    expect(r.contributions.find((c) => c.signal === "Desvío de tu patrón")).toBeUndefined();
  });

  it("calcula los días hasta la nómina cruzando de mes", () => {
    expect(daysToPayday(new Date("2026-10-29T10:00:00"), 28)).toBe(30);
    expect(daysToPayday(new Date("2026-10-17T03:12:00"), 28)).toBe(11);
  });
});

describe("fricción adaptativa + Ulises", () => {
  it("sin fricción para lo cotidiano", () => {
    const p: PurchaseIntent = { amount: 42, merchant: "Mercadona", category: "supermercado", kind: "card", at: "2026-10-17T18:30:00" };
    const d = decideFriction(p, measure(p, demoProfile, history), defaultRules, demoProfile);
    expect(d.level).toBe(0);
  });

  it("la regla escrita en frío manda sobre el sistema", () => {
    const p: PurchaseIntent = { amount: 129, merchant: "RunFast", category: "moda", kind: "card", at: DEMO_NOW };
    const d = decideFriction(p, measure(p, demoProfile, history), defaultRules, demoProfile);
    expect(d.mode).toBe("regla_ulises");
    expect(d.matchedRules.map((r) => r.id)).toContain("noche");
  });

  it("el riesgo de estafa manda sobre todo", () => {
    const p: PurchaseIntent = {
      amount: 2000, merchant: "Transferencia", category: "transferencia", kind: "transfer", at: "2026-10-17T11:00:00",
      beneficiary: "ES00 9999 0000 1111 2222 3333", context: "cuenta segura",
    };
    const d = decideFriction(p, measure(p, demoProfile, history), defaultRules, demoProfile);
    expect(d.mode).toBe("escudo_estafa");
    expect(d.matchedRules.map((r) => r.id)).toContain("transfer-nueva");
  });

  it("una regla de tipo pregunta acompaña al debate en vez de sustituirlo", () => {
    const p: PurchaseIntent = { amount: 999, merchant: "LuxTime", category: "moda", kind: "card", at: "2026-10-17T18:00:00" };
    const d = decideFriction(p, measure(p, demoProfile, history, detectDarkPatterns(shopPage)), defaultRules, demoProfile);
    expect(d.mode).toBe("debate");
    expect(d.matchedRules.map((r) => r.id)).toEqual(["viaje"]);
  });

  it("sin reglas que apliquen, un termómetro alto abre el debate", () => {
    const p: PurchaseIntent = { amount: 999, merchant: "LuxTime", category: "moda", kind: "card", at: "2026-10-17T18:00:00" };
    const d = decideFriction(p, measure(p, demoProfile, history, detectDarkPatterns(shopPage)), [], demoProfile);
    expect(d.mode).toBe("debate");
    expect(d.facts[0]).toMatch(/horas de tu trabajo/);
  });
});
