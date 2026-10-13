import type { DarkPatternFinding, DarkPatternKind, PageElement } from "./types";

interface Detector {
  kind: DarkPatternKind;
  severity: 1 | 2 | 3;
  explanation: string;
  matches: (el: PageElement) => boolean;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const TIMER = /\b\d{1,2}:\d{2}(:\d{2})?\b/;
const URGENCY = /(termina en|acaba en|expira|ultima oportunidad|solo hoy|oferta flash|antes de que|se agota el tiempo|ahora o nunca)/;
const SCARCITY = /(solo quedan?|ultimas? \d+|quedan \d+|ultimas unidades|casi agotado|stock limitado)/;
const SOCIAL = /(\d+ personas? (lo )?(estan )?(viendo|mirando)|\d+ (personas|clientes) (lo )?(han )?comprad|alguien de .+ acaba de comprar|en \d+ carritos)/;
const SHAMING = /(no,? (gracias,? )?(prefiero|quiero|me gusta)|no me importa (ahorrar|mi)|prefiero pagar mas|no quiero proteger)/;
const PRICE = /(\+?\s?\d+([.,]\d{1,2})?\s?€|€\s?\d+)/;
const ADDON = /(seguro|proteccion|garantia extendida|donacion|envio premium|suscripcion|club|membresia)/;
const HIDDEN_FEE = /(gastos? de gestion|tasa de servicio|cargo por|comision de)/;
const STEALTH_SUB = /(prueba gratis|gratis durante|despues \d+([.,]\d+)?\s?€\s?\/\s?(mes|ano)|se renueva automaticamente|renovacion automatica)/;

const DETECTORS: Detector[] = [
  {
    kind: "falsa_urgencia",
    severity: 3,
    explanation: "Una cuenta atrás te empuja a decidir antes de pensar. Suelen reiniciarse al recargar la página.",
    matches: (el) => (el.isTimer ?? false) || (TIMER.test(el.text) && URGENCY.test(norm(el.text))) || URGENCY.test(norm(el.text)),
  },
  {
    kind: "falsa_escasez",
    severity: 2,
    explanation: "Los avisos de pocas unidades crean miedo a perder la oportunidad, a menudo sin que el stock sea real.",
    matches: (el) => SCARCITY.test(norm(el.text)),
  },
  {
    kind: "presion_social",
    severity: 2,
    explanation: "Saber que otras personas 'están mirando' acelera la decisión, aunque no cambie si te conviene.",
    matches: (el) => SOCIAL.test(norm(el.text)),
  },
  {
    kind: "preseleccion",
    severity: 3,
    explanation: "Un extra de pago viene marcado por defecto: si no lo ves, lo pagas.",
    matches: (el) => el.checked === true && PRICE.test(el.text) && ADDON.test(norm(el.text)),
  },
  {
    kind: "confirmshaming",
    severity: 1,
    explanation: "El botón para rechazar está escrito para que te sientas mal diciendo que no.",
    matches: (el) => SHAMING.test(norm(el.text)),
  },
  {
    kind: "coste_oculto",
    severity: 2,
    explanation: "Aparece un cargo extra que no estaba en el precio anunciado.",
    matches: (el) => HIDDEN_FEE.test(norm(el.text)) && PRICE.test(el.text),
  },
  {
    kind: "suscripcion_encubierta",
    severity: 3,
    explanation: "Lo 'gratis' se convierte en un cobro recurrente si no lo cancelas a tiempo.",
    matches: (el) => STEALTH_SUB.test(norm(el.text)),
  },
];

/** Scans the visible elements of a checkout page and returns one finding per matching element and kind. */
export function detectDarkPatterns(elements: PageElement[]): DarkPatternFinding[] {
  const findings: DarkPatternFinding[] = [];
  for (const el of elements) {
    const text = el.text.trim();
    if (!text) continue;
    for (const d of DETECTORS) {
      if (d.matches(el)) {
        findings.push({ kind: d.kind, severity: d.severity, evidence: text.slice(0, 140), explanation: d.explanation, ref: el.ref });
      }
    }
  }
  return findings;
}

/** 0-25 points of external pressure, capped so the shop alone can't max out the thermometer. */
export function pressureScore(findings: DarkPatternFinding[]): number {
  const kinds = new Map<DarkPatternKind, number>();
  for (const f of findings) kinds.set(f.kind, Math.max(kinds.get(f.kind) ?? 0, f.severity));
  let total = 0;
  for (const sev of kinds.values()) total += sev * 3;
  return Math.min(25, total);
}

export const DARK_PATTERN_LABEL: Record<DarkPatternKind, string> = {
  falsa_urgencia: "Falsa urgencia",
  falsa_escasez: "Falsa escasez",
  presion_social: "Presión social",
  preseleccion: "Extra preseleccionado",
  confirmshaming: "Te hace sentir culpable por decir que no",
  coste_oculto: "Coste oculto",
  suscripcion_encubierta: "Suscripción encubierta",
};
