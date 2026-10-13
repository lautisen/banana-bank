import { OUT_OF_SCOPE_REPLY } from '../guardrails/screen';
import { JUDGE_BLOCKED_REPLY } from '../guardrails/judge';

// Replies that never go through the model (guardrails, failures) must still follow the language of
// the customer's message, like the model's own replies. Customers write in Spanish or English;
// anything else gets English.
type Language = 'es' | 'en';
const spanish =
  /[¿¡ñáéíóú]|\b(que|como|cuanto|cual|donde|hola|quiero|puedo|puedes|tengo|hace|hoy|gracias|cuenta|cuentas|dinero|transferencia|transfiere|comision|ayuda|ayudame|dime|necesito|quien|cuando|porque|tu|tus|mi|mis|el|la|los|las|del|de|y|es|un|una|en|con|haz|hazme|dame|escribe|para|por favor)\b/i;
export const replyLanguage = (text: string): Language => (spanish.test(text) ? 'es' : 'en');

const replies = {
  out_of_scope: {
    en: OUT_OF_SCOPE_REPLY,
    es: 'Solo puedo ayudarte con tus cuentas de Banana Bank, transferencias, comisiones y condiciones, o ponerte en contacto con una persona. ¿Qué quieres hacer con tu cuenta?',
  },
  judge_blocked: {
    en: JUDGE_BLOCKED_REPLY,
    es: 'No he podido verificar mi respuesta, así que no la envío. Tus cuentas y cualquier propuesta de transferencia siguen igual; puedes revisarlas en la app o pedir hablar con una persona.',
  },
  unavailable: {
    en: "Sorry, I can't answer right now. Please try again in a few minutes or ask for human support.",
    es: 'Lo siento, ahora mismo no puedo responder. Inténtalo de nuevo en unos minutos o pide hablar con una persona.',
  },
} as const;

export function fixedReply(kind: keyof typeof replies, customerMessage: string) {
  return replies[kind][replyLanguage(customerMessage)];
}

export function chatPausedReply(customerMessage: string, until: string) {
  return replyLanguage(customerMessage) === 'es'
    ? `El chat del asistente está en pausa hasta ${until} (hora de Madrid) por uso indebido repetido. Tus cuentas, transferencias y la protección de pagos siguen funcionando con normalidad.`
    : `The assistant chat is paused until ${until} (Madrid time) after repeated misuse. Your accounts, transfers and payment protection keep working as usual.`;
}
