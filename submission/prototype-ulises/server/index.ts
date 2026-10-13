import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { measure } from "../src/core/thermometer";
import { decideFriction } from "../src/core/ulises";
import { summarizeAccount } from "../src/core/accountSummary";
import { AbuseControl } from "./abuse";
import { chat, debate, explain, llmEnabled } from "./llm";
import type { DarkPatternFinding, PurchaseIntent, Transaction, UlisesRule, UserProfile } from "../src/core/types";

const app = express();
app.use(express.json({ limit: "1mb" }));

/**
 * The request carries everything the engine needs. In production this would come from the bank's
 * own data on the device; here the demo frontend sends its synthetic data.
 */
const EvaluateBody = z.object({
  purchase: z.custom<PurchaseIntent>((v) => typeof v === "object" && v !== null && "amount" in v),
  profile: z.custom<UserProfile>((v) => typeof v === "object" && v !== null),
  history: z.array(z.custom<Transaction>()),
  rules: z.array(z.custom<UlisesRule>()),
  patterns: z.array(z.custom<DarkPatternFinding>()).default([]),
  goals: z.array(z.string()).default([]),
});

function evaluate(body: z.infer<typeof EvaluateBody>) {
  const thermo = measure(body.purchase, body.profile, body.history, body.patterns);
  const decision = decideFriction(body.purchase, thermo, body.rules, body.profile);
  return { thermo, decision };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, llm: llmEnabled() ? "claude" : "plantilla" });
});

app.post("/api/explain", async (req, res) => {
  const parsed = EvaluateBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.message });
  const { thermo, decision } = evaluate(parsed.data);
  res.json(await explain(parsed.data.purchase, thermo, decision, parsed.data.goals));
});

app.post("/api/debate", async (req, res) => {
  const parsed = EvaluateBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.message });
  const { thermo, decision } = evaluate(parsed.data);
  res.json(await debate(parsed.data.purchase, thermo, decision, parsed.data.goals));
});

/** In-memory for the demo; in production this state lives in the bank's DB, keyed by customer id. */
const abuse = new AbuseControl();

const ChatBody = z.object({
  userId: z.string().min(1).max(64),
  question: z.string().min(1).max(2000),
  profile: z.custom<UserProfile>((v) => typeof v === "object" && v !== null),
  history: z.array(z.custom<Transaction>()),
  now: z.string(),
  goals: z.array(z.string()).default([]),
});

app.post("/api/chat", async (req, res) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.message });
  const { userId, question, profile, history, now, goals } = parsed.data;

  const gate = abuse.admit(userId);
  if (gate.suspended) {
    res.setHeader("Retry-After", String(gate.retryAfterSeconds));
    return void res.status(429).json({ suspended: true, abuse: gate });
  }
  const reply = await chat(question, summarizeAccount(profile, history, now), goals);
  const status = abuse.record(userId, reply.guardrails);
  res.json({ ...reply, abuse: status });
});

app.get("/api/abuse/:userId", (req, res) => {
  res.json(abuse.status(req.params.userId));
});

app.post("/api/abuse/:userId/appeal", (req, res) => {
  res.json(abuse.appeal(req.params.userId));
});

app.post("/api/abuse/:userId/reset", (req, res) => {
  if (process.env.NODE_ENV === "production" && process.env.ULISES_DEMO !== "1") return void res.status(403).end();
  abuse.reset(req.params.userId);
  res.json(abuse.status(req.params.userId));
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Ulises API en http://localhost:${port} · voz: ${llmEnabled() ? "Claude" : "plantillas offline"}`);
});
