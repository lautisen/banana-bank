import type { GuardrailEvent } from "./guardrails";

/**
 * Abuse control for the free-text chat ("Pregúntale a Ulises").
 *
 * - Strikes: guardrail hits caused by the USER (not by the model) add points inside a sliding window.
 *   Prompt injection = 2, off-topic = 1, flooding (too many messages per minute) = 2.
 *   Judge rejections and invented figures are the model's fault and never count against the user.
 * - Reaching STRIKE_THRESHOLD points suspends the chat with an escalating ladder: 5 min → 15 min → 30 min → 1 h → 1 día.
 * - From LABEL_FROM_LEVEL suspensions on, the profile gets the "AI abuser" label.
 *
 * Safeguards (see docs/guardrails.md):
 * - A suspension only closes the chat. The thermometer, the dark-pattern shield and the scam shield keep working:
 *   cutting fraud protection to someone who annoyed a chatbot would be a harm in itself.
 * - The label lives only in this module: it is never sent to credit scoring, pricing or any other decision.
 * - The label expires (LABEL_TTL_MS) and the ladder steps back down after a clean period (DECAY_MS).
 * - The user can see the label, the reason and the date, and can appeal.
 */

export const SUSPENSION_LADDER_MS = [5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 24 * 60 * 60_000];
export const STRIKE_THRESHOLD = 3;
export const STRIKE_WINDOW_MS = 10 * 60_000;
export const FLOOD_MAX_PER_MINUTE = 8;
export const LABEL_FROM_LEVEL = 1;
export const LABEL_TTL_MS = 90 * 24 * 60 * 60_000;
export const DECAY_MS = 7 * 24 * 60 * 60_000;
export const AI_ABUSER_LABEL = "AI abuser";

const STRIKE_POINTS: Record<string, number> = { inyeccion_prompt: 2, fuera_de_ambito: 1 };

interface Strike {
  at: number;
  points: number;
  rule: string;
}

export interface AbuseLabel {
  label: typeof AI_ABUSER_LABEL;
  since: string;
  expires: string;
  reason: string;
  appealed: boolean;
}

interface UserAbuseState {
  strikes: Strike[];
  messages: number[];
  level: number;
  suspendedUntil: number;
  lastSuspensionAt: number;
  label: AbuseLabel | null;
  history: { at: string; minutes: number; reason: string }[];
}

export interface AbuseStatus {
  suspended: boolean;
  suspendedUntil: string | null;
  retryAfterSeconds: number;
  level: number;
  strikePoints: number;
  label: AbuseLabel | null;
  history: UserAbuseState["history"];
}

export class AbuseControl {
  private users = new Map<string, UserAbuseState>();
  constructor(private now: () => number = Date.now) {}

  private state(userId: string): UserAbuseState {
    let s = this.users.get(userId);
    if (!s) {
      s = { strikes: [], messages: [], level: 0, suspendedUntil: 0, lastSuspensionAt: 0, label: null, history: [] };
      this.users.set(userId, s);
    }
    const t = this.now();
    if (s.level > 0 && t - s.lastSuspensionAt > DECAY_MS) {
      s.level -= 1;
      s.lastSuspensionAt = t;
    }
    if (s.label && Date.parse(s.label.expires) <= t) s.label = null;
    s.strikes = s.strikes.filter((x) => t - x.at <= STRIKE_WINDOW_MS);
    s.messages = s.messages.filter((x) => t - x <= 60_000);
    return s;
  }

  status(userId: string): AbuseStatus {
    const s = this.state(userId);
    const t = this.now();
    const suspended = s.suspendedUntil > t;
    return {
      suspended,
      suspendedUntil: suspended ? new Date(s.suspendedUntil).toISOString() : null,
      retryAfterSeconds: suspended ? Math.ceil((s.suspendedUntil - t) / 1000) : 0,
      level: s.level,
      strikePoints: s.strikes.reduce((a, x) => a + x.points, 0),
      label: s.label,
      history: s.history,
    };
  }

  /** Call before processing a message. Counts it for flood detection. */
  admit(userId: string): AbuseStatus {
    const s = this.state(userId);
    if (s.suspendedUntil > this.now()) return this.status(userId);
    s.messages.push(this.now());
    if (s.messages.length > FLOOD_MAX_PER_MINUTE) this.addStrike(s, "inundacion", 2);
    return this.status(userId);
  }

  /** Call after the guardrails ran. Only user-caused events become strikes. */
  record(userId: string, events: GuardrailEvent[]): AbuseStatus {
    const s = this.state(userId);
    for (const e of events) {
      const pts = e.stage === "input" ? STRIKE_POINTS[e.rule] : undefined;
      if (pts) this.addStrike(s, e.rule, pts);
    }
    return this.status(userId);
  }

  appeal(userId: string): AbuseStatus {
    const s = this.state(userId);
    if (s.label) s.label.appealed = true;
    return this.status(userId);
  }

  /** Demo only: lets the presenter start the abuse demo again. */
  reset(userId: string) {
    this.users.delete(userId);
  }

  private addStrike(s: UserAbuseState, rule: string, points: number) {
    const t = this.now();
    s.strikes.push({ at: t, points, rule });
    const total = s.strikes.reduce((a, x) => a + x.points, 0);
    if (total < STRIKE_THRESHOLD) return;

    const ms = SUSPENSION_LADDER_MS[Math.min(s.level, SUSPENSION_LADDER_MS.length - 1)];
    const reason = summarize(s.strikes);
    s.level = Math.min(s.level + 1, SUSPENSION_LADDER_MS.length);
    s.suspendedUntil = t + ms;
    s.lastSuspensionAt = t;
    s.strikes = [];
    s.messages = [];
    s.history.push({ at: new Date(t).toISOString(), minutes: ms / 60_000, reason });
    if (s.level >= LABEL_FROM_LEVEL) {
      s.label = {
        label: AI_ABUSER_LABEL,
        since: s.label?.since ?? new Date(t).toISOString(),
        expires: new Date(t + LABEL_TTL_MS).toISOString(),
        reason,
        appealed: s.label?.appealed ?? false,
      };
    }
  }
}

const RULE_TEXT: Record<string, string> = {
  inyeccion_prompt: "intentos de manipular las instrucciones de la IA",
  fuera_de_ambito: "peticiones ajenas a la cuenta",
  inundacion: "demasiados mensajes por minuto",
};

function summarize(strikes: Strike[]): string {
  const counts = new Map<string, number>();
  for (const s of strikes) counts.set(s.rule, (counts.get(s.rule) ?? 0) + 1);
  return [...counts].map(([r, n]) => `${n}× ${RULE_TEXT[r] ?? r}`).join(", ");
}
