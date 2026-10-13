/**
 * Guardrails around every LLM call. Ulises' AI has ONE job: talk about the payment in front of the user.
 *
 *  1. Input:  free text from users (goals, transfer concept) is length-capped, stripped of markup and screened
 *             for prompt injection and off-topic requests ("make me a landing page"). Flagged text never reaches
 *             the model; it is replaced by a neutral placeholder.
 *  2. Prompt: user text is wrapped in <datos_usuario> tags and the system prompt says it is data, never orders.
 *  3. Output: every response is checked before reaching the UI: no code/markup/links, length caps, no invented
 *             numbers, no verdicts or product recommendations. Any violation → deterministic template instead.
 */

export interface GuardrailEvent {
  stage: "input" | "output";
  rule: string;
  sample: string;
}

const MAX_GOALS = 5;
const MAX_GOAL_CHARS = 120;
const MAX_CONTEXT_CHARS = 300;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Attempts to override the system prompt or extract it. */
const INJECTION = [
  /ignor[ae]\w* (todas? )?(las |tus |the |all |previous |prior |above )*(instruc|reglas|rules|prompt)/,
  /olvida\w* (todo|tus|las) /,
  /(system prompt|prompt del sistema|tus instrucciones|your instructions)/,
  /(a partir de ahora|from now on) (eres|you are|act)/,
  /\b(actua|act|pretend|finge) (como|as|to be)\b/,
  /\b(jailbreak|dan mode|developer mode|modo desarrollador)\b/,
  /<\/?(system|instructions|datos_usuario)>/,
];

/** Requests that have nothing to do with a payment decision. */
const OFF_TOPIC = [
  /\b(html|css|javascript|typescript|python|sql|landing ?page|pagina web|website|web page)\b/,
  /\b(escribe|escribeme|redacta|genera|crea|create|write|make|build|hazme)\b.{0,40}\b(archivo|file|poema|poem|cancion|song|cuento|story|ensayo|essay|codigo|code|app|script)\b/,
  /\b(how (can|do) i (create|build|code|program)|como (puedo|se) (programar|crear un archivo))\b/,
  /\b(receta|recipe|traduce|translate|chiste|joke)\b/,
];

const MARKUP = /<[^>]{1,200}>|```|\{\{|\}\}/g;

export function screenText(text: string, maxChars: number): { clean: string; events: GuardrailEvent[] } {
  const events: GuardrailEvent[] = [];
  // Injection is checked on the raw text: tags like </datos_usuario> are themselves the attack.
  if (INJECTION.some((r) => r.test(norm(text)))) {
    events.push({ stage: "input", rule: "inyeccion_prompt", sample: text.slice(0, 60) });
    return { clean: "[texto retirado por seguridad]", events };
  }
  let clean = text.replace(MARKUP, " ").replace(/\s+/g, " ").trim();
  if (clean.length > maxChars) {
    events.push({ stage: "input", rule: "longitud", sample: clean.slice(0, 60) });
    clean = clean.slice(0, maxChars);
  }
  const n = norm(clean);
  if (OFF_TOPIC.some((r) => r.test(n))) {
    events.push({ stage: "input", rule: "fuera_de_ambito", sample: clean.slice(0, 60) });
    return { clean: "[texto fuera de ámbito retirado]", events };
  }
  return { clean, events };
}

export function screenGoals(goals: string[]): { goals: string[]; events: GuardrailEvent[] } {
  const events: GuardrailEvent[] = [];
  if (goals.length > MAX_GOALS) events.push({ stage: "input", rule: "demasiados_objetivos", sample: String(goals.length) });
  const out = goals.slice(0, MAX_GOALS).flatMap((g) => {
    const r = screenText(g, MAX_GOAL_CHARS);
    events.push(...r.events);
    return r.events.some((e) => e.rule !== "longitud") ? [] : [r.clean];
  });
  return { goals: out, events };
}

export const screenContext = (context: string | undefined) => (context ? screenText(context, MAX_CONTEXT_CHARS) : { clean: undefined, events: [] });

// --- Output checks ---

const OUTPUT_FORBIDDEN: { rule: string; re: RegExp }[] = [
  { rule: "codigo_o_markup", re: /```|<\/?[a-z][^>]*>|\bfunction\s*\(|\bconst\s+\w+\s*=|\{[^}]*:[^}]*\}/i },
  { rule: "enlaces", re: /https?:\/\/|www\.|\b[\w-]+\.(com|es|io|net|org)\b/i },
  { rule: "veredicto", re: /\b(debes|deberias|tienes que|te recomiendo|mi consejo es|la respuesta es) (no )?(comprar\w*|compra\w*|pagar\w*|hacerlo|dejarlo\w*)\b/i },
  { rule: "recomienda_producto", re: /\b(prestamo|credito rapido|tarjeta de credito|financia(cion|lo)|invierte|aplaza(do|r) el pago|paga en \d+ plazos)\b/i },
  { rule: "revela_prompt", re: /(system prompt|mis instrucciones|me han programado|como modelo de lenguaje)/i },
];

/** Numbers a response may mention: only those present in the data the engine computed. */
export function allowedNumbers(data: string): number[] {
  return [0, 1, 100, ...extractNumbers(data)];
}

/** Rounding is fine ("casi 1.000 €" for 999 €); a figure that appears nowhere in the data is not. */
const isAllowed = (x: number, allowed: number[]) => allowed.some((a) => Math.abs(x - a) <= Math.max(0.5, a * 0.02));

export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    let raw = m[0];
    // "1.000" or "1.000,50" (es-ES thousands) vs "29,99" / "4.5" (decimals)
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) raw = raw.replace(/\./g, "").replace(",", ".");
    else raw = raw.replace(",", ".");
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(Math.round(n * 100) / 100);
  }
  return out;
}

export function checkOutput(texts: string[], data: string, maxCharsEach: number): GuardrailEvent[] {
  const events: GuardrailEvent[] = [];
  const allowed = allowedNumbers(data);
  for (const t of texts) {
    if (t.length > maxCharsEach) events.push({ stage: "output", rule: "demasiado_largo", sample: t.slice(0, 60) });
    const n = norm(t);
    for (const f of OUTPUT_FORBIDDEN) if (f.re.test(f.rule === "codigo_o_markup" || f.rule === "enlaces" ? t : n))
      events.push({ stage: "output", rule: f.rule, sample: t.slice(0, 60) });
    const invented = extractNumbers(t).filter((x) => !isAllowed(x, allowed));
    if (invented.length) events.push({ stage: "output", rule: "cifra_inventada", sample: `${invented.join(", ")} en «${t.slice(0, 50)}»` });
  }
  return events;
}
