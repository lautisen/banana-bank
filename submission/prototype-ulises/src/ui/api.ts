import type { DarkPatternFinding, PurchaseIntent, Transaction, UlisesRule, UserProfile } from "../core/types";

export interface EvalPayload {
  purchase: PurchaseIntent;
  profile: UserProfile;
  history: Transaction[];
  rules: UlisesRule[];
  patterns: DarkPatternFinding[];
  goals: string[];
}

export interface Debate {
  demonio: string[];
  angel: string[];
  pregunta_final: string;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchExplain = (p: EvalPayload) => post<{ text: string; source: string }>("/api/explain", p);
export const fetchDebate = (p: EvalPayload) => post<{ debate: Debate; source: string }>("/api/debate", p);
export const fetchHealth = () => fetch("/api/health").then((r) => r.json() as Promise<{ ok: boolean; llm: string }>);

export interface AbuseStatus {
  suspended: boolean;
  suspendedUntil: string | null;
  retryAfterSeconds: number;
  level: number;
  strikePoints: number;
  label: { label: string; since: string; expires: string; reason: string; appealed: boolean } | null;
  history: { at: string; minutes: number; reason: string }[];
}

export interface GuardrailEvent {
  stage: "input" | "output";
  rule: string;
  sample: string;
}

export interface ChatResponse {
  answer?: string;
  source?: string;
  guardrails?: GuardrailEvent[];
  judge?: { relevante: boolean; seguro: boolean; fiel: boolean; enviar: boolean; motivo: string };
  suspended?: boolean;
  abuse: AbuseStatus;
}

export async function fetchChat(body: {
  userId: string;
  question: string;
  profile: UserProfile;
  history: Transaction[];
  now: string;
  goals: string[];
}): Promise<ChatResponse> {
  const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok && res.status !== 429) throw new Error(`/api/chat → ${res.status}`);
  return res.json() as Promise<ChatResponse>;
}

export const fetchAbuse = (userId: string) => fetch(`/api/abuse/${userId}`).then((r) => r.json() as Promise<AbuseStatus>);
export const appealAbuse = (userId: string) => post<AbuseStatus>(`/api/abuse/${userId}/appeal`, {});
export const resetAbuse = (userId: string) => post<AbuseStatus>(`/api/abuse/${userId}/reset`, {});
