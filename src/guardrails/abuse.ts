import { appDb } from '../db';
import type { ScreenEvent } from './screen';

// Abuse control for the customer chat.
// - Strikes come only from what the CUSTOMER sends (prompt injection = 2, off-topic = 1, flooding = 2),
//   never from model failures. 3 points within 10 minutes suspend the chat with an escalating
//   ladder: 5 min -> 15 min -> 30 min -> 1 h -> 1 day. The level steps back down after 7 clean days.
// - From LABEL_FROM_LEVEL suspensions on, the profile carries the "AI abuser" label.
// Safeguards: a suspension only closes the chat; accounts, transfers and the Ulises checks keep
// working. The label stays in this module (never used for credit, pricing or risk decisions),
// expires after 90 days, is visible to the customer with its reason, and can be appealed.

export const SUSPENSION_LADDER_MS = [5, 15, 30, 60, 24 * 60].map((m) => m * 60_000);
export const STRIKE_THRESHOLD = 3;
export const STRIKE_WINDOW_MS = 10 * 60_000;
export const FLOOD_MAX_PER_MINUTE = 8;
export const LABEL_FROM_LEVEL = Number(process.env.AI_ABUSE_LABEL_FROM_LEVEL || 1);
export const LABEL_TTL_MS = 90 * 24 * 3_600_000;
export const DECAY_MS = 7 * 24 * 3_600_000;
export const AI_ABUSER_LABEL = 'AI abuser';

const POINTS: Record<string, number> = { prompt_injection: 2, off_topic: 1 };
const RULE_TEXT: Record<string, string> = {
  prompt_injection: 'attempts to override the assistant instructions',
  off_topic: 'requests unrelated to banking',
  flooding: 'too many messages per minute',
};

type Label = { label: string; since: string; expires: string; reason: string; appealed: boolean };
type State = {
  strikes: { at: number; points: number; rule: string }[];
  messages: number[];
  level: number;
  suspendedUntil: number;
  lastSuspensionAt: number;
  label: Label | null;
  history: { at: string; minutes: number; reason: string }[];
};
export type AiUsageStatus = {
  suspended: boolean;
  suspendedUntil: string | null;
  retryAfterSeconds: number;
  level: number;
  strikePoints: number;
  label: Label | null;
  history: State['history'];
};

const fresh = (): State => ({
  strikes: [],
  messages: [],
  level: 0,
  suspendedUntil: 0,
  lastSuspensionAt: 0,
  label: null,
  history: [],
});

function load(userId: string, t: number): State {
  const row = appDb().prepare('SELECT data FROM ai_usage WHERE user_id=?').get(userId) as
    { data: string } | undefined;
  const s: State = row ? JSON.parse(row.data) : fresh();
  if (s.level > 0 && t - s.lastSuspensionAt > DECAY_MS) {
    s.level -= 1;
    s.lastSuspensionAt = t;
  }
  if (s.label && Date.parse(s.label.expires) <= t) s.label = null;
  s.strikes = s.strikes.filter((x) => t - x.at <= STRIKE_WINDOW_MS);
  s.messages = s.messages.filter((x) => t - x <= 60_000);
  return s;
}
const save = (userId: string, s: State) =>
  appDb()
    .prepare(
      'INSERT INTO ai_usage(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',
    )
    .run(userId, JSON.stringify(s));

function view(s: State, t: number): AiUsageStatus {
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

function strike(s: State, rule: string, points: number, t: number) {
  s.strikes.push({ at: t, points, rule });
  if (s.strikes.reduce((a, x) => a + x.points, 0) < STRIKE_THRESHOLD) return;
  const ms = SUSPENSION_LADDER_MS[Math.min(s.level, SUSPENSION_LADDER_MS.length - 1)];
  const counts = new Map<string, number>();
  for (const x of s.strikes) counts.set(x.rule, (counts.get(x.rule) ?? 0) + 1);
  const reason = [...counts].map(([r, n]) => `${n}× ${RULE_TEXT[r] ?? r}`).join(', ');
  s.level = Math.min(s.level + 1, SUSPENSION_LADDER_MS.length);
  s.suspendedUntil = t + ms;
  s.lastSuspensionAt = t;
  s.strikes = [];
  s.messages = [];
  s.history.push({ at: new Date(t).toISOString(), minutes: ms / 60_000, reason });
  if (s.level >= LABEL_FROM_LEVEL)
    s.label = {
      label: AI_ABUSER_LABEL,
      since: s.label?.since ?? new Date(t).toISOString(),
      expires: new Date(t + LABEL_TTL_MS).toISOString(),
      reason,
      appealed: s.label?.appealed ?? false,
    };
}

export function aiUsage(userId: string, now = Date.now()) {
  return view(load(userId, now), now);
}

// Before a message is processed: counts it for flooding and reports an active suspension.
export function admitMessage(userId: string, now = Date.now()) {
  const s = load(userId, now);
  if (s.suspendedUntil <= now) {
    s.messages.push(now);
    if (s.messages.length > FLOOD_MAX_PER_MINUTE) strike(s, 'flooding', 2, now);
    save(userId, s);
  }
  return view(s, now);
}

export function recordScreenEvents(userId: string, events: ScreenEvent[], now = Date.now()) {
  const s = load(userId, now);
  for (const e of events) if (POINTS[e.rule]) strike(s, e.rule, POINTS[e.rule], now);
  save(userId, s);
  return view(s, now);
}

export function appealLabel(userId: string, now = Date.now()) {
  const s = load(userId, now);
  if (s.label) s.label.appealed = true;
  save(userId, s);
  return view(s, now);
}
