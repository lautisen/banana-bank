// Input guardrails for the customer chat. Banana Bank's assistant has one job: the customer's banking.
// Requests that have nothing to do with it (e.g. "make me a landing page in HTML") and attempts to
// override the instructions never reach the model; the customer gets a fixed, polite redirection.

export type ScreenEvent = { rule: 'prompt_injection' | 'off_topic'; sample: string };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const INJECTION = [
  /ignor[ae]\w* (todas? )?(las |tus |the |all |your |previous |prior |above |any )*(instruc|reglas|rules|prompt|guidelines)/,
  /olvida\w* (todo|tus|las) (instruc|reglas|normas)/,
  /\b(system prompt|prompt del sistema|developer message|mensaje del desarrollador)\b/,
  /(a partir de ahora|from now on),? (eres|you are|act)/,
  /\b(jailbreak|dan mode|developer mode|modo desarrollador)\b/,
  /<\/?(system|instructions|developer)>/,
];

// Kept deliberately narrow: a false positive here costs a customer a strike (see abuse.ts).
const OFF_TOPIC = [
  /\b(html|css|javascript|typescript|python|sql|landing ?page)\b/,
  /\b(write|create|make|build|generate|escribe|escribeme|redacta|genera|crea|hazme)\b.{0,40}\b(poem|poema|song|cancion|story|cuento|essay|ensayo|code|codigo|script|app|website|pagina web)\b/,
  /\b(how (can|do) i (create|build|code|program)|como (puedo|se) programar)\b/,
  /\b(recipe|receta|tell me a joke|cuentame un chiste)\b/,
];

export function screenCustomerMessage(text: string): ScreenEvent[] {
  const t = norm(text);
  const sample = text.slice(0, 80);
  if (INJECTION.some((r) => r.test(t))) return [{ rule: 'prompt_injection', sample }];
  if (OFF_TOPIC.some((r) => r.test(t))) return [{ rule: 'off_topic', sample }];
  return [];
}

export const OUT_OF_SCOPE_REPLY =
  'I can only help with your Banana Bank accounts, transfers, fees and policies, or connect you with a person. What would you like to do with your account?';
