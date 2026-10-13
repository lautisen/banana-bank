import { useEffect, useMemo, useState } from "react";
import { DEMO_NOW, buildDemoHistory, defaultRules, demoProfile } from "./core/sampleData";
import { measure } from "./core/thermometer";
import { decideFriction } from "./core/ulises";
import type { DarkPatternFinding, FrictionDecision, PurchaseIntent, ThermometerResult, UlisesRule, UserProfile } from "./core/types";
import { fetchHealth, type EvalPayload } from "./ui/api";
import { AskUlises } from "./ui/AskUlises";
import { ColdMode } from "./ui/ColdMode";
import { Dashboard, type LogEntry } from "./ui/Dashboard";
import { FrictionModal, type Outcome } from "./ui/FrictionModal";
import { Shop, type Product } from "./ui/Shop";
import { Thermometer } from "./ui/Thermometer";
import { Transfer } from "./ui/Transfer";

type Tab = "frio" | "tienda" | "transferencia" | "pregunta" | "panel";

const TABS: { id: Tab; label: string }[] = [
  { id: "frio", label: "1 · Modo frío" },
  { id: "tienda", label: "2 · Tienda" },
  { id: "transferencia", label: "3 · Transferencia" },
  { id: "pregunta", label: "4 · Pregúntale" },
  { id: "panel", label: "5 · Panel" },
];

const TIMES = [
  { label: "Viernes 03:12 (madrugada)", value: DEMO_NOW },
  { label: "Viernes 18:30 (tarde)", value: "2026-10-17T18:30:00" },
  { label: "Viernes 11:00 (mañana)", value: "2026-10-17T11:00:00" },
];

const USER_ID = "lucia-demo";

interface Pending {
  purchase: PurchaseIntent;
  thermo: ThermometerResult;
  decision: FrictionDecision;
  payload: EvalPayload;
  what: string;
}

export function App() {
  const [tab, setTab] = useState<Tab>("tienda");
  const [profile, setProfile] = useState<UserProfile>(demoProfile);
  const [rules, setRules] = useState<UlisesRule[]>(defaultRules);
  const [goals, setGoals] = useState<string[]>(["Viaje a Japón en abril (faltan 900 €)"]);
  const [now, setNow] = useState(DEMO_NOW);
  const [shieldOn, setShieldOn] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [last, setLast] = useState<ThermometerResult | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [voice, setVoice] = useState("…");
  const history = useMemo(() => buildDemoHistory(7, now), [now]);

  useEffect(() => {
    fetchHealth()
      .then((h) => setVoice(h.llm === "claude" ? "IA conectada" : "Modo offline (plantillas)"))
      .catch(() => setVoice("API no disponible"));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const attempt = (purchase: PurchaseIntent, what: string, patterns: DarkPatternFinding[]) => {
    const thermo = measure(purchase, profile, history, patterns);
    const decision = decideFriction(purchase, thermo, rules, profile);
    setLast(thermo);
    if (decision.level === 0) {
      setLog((l) => [...l, { at: purchase.at, what, amount: purchase.amount, score: thermo.score, level: thermo.level, mode: decision.mode, outcome: "pagado" }]);
      setToast(`Pagado sin fricción · termómetro ${thermo.score}/100`);
      return;
    }
    setPending({ purchase, thermo, decision, what, payload: { purchase, profile, history, rules, patterns, goals } });
  };

  const close = (outcome: Outcome, note?: string) => {
    if (!pending) return;
    const { purchase, thermo, decision, what } = pending;
    setLog((l) => [...l, { at: purchase.at, what, amount: purchase.amount, score: thermo.score, level: thermo.level, mode: decision.mode, outcome, note }]);
    setPending(null);
    setToast(outcome === "pagado" ? "Pagado. Tu decisión, con toda la información." : "Decisión guardada en tu panel.");
  };

  const onCheckout = (p: Product, total: number, patterns: DarkPatternFinding[]) =>
    attempt({ amount: total, merchant: p.merchant, category: p.category, kind: "card", at: now }, p.name, patterns);

  const onTransfer = (t: { beneficiary: string; amount: number; context: string }) =>
    attempt(
      { amount: t.amount, merchant: "Transferencia", category: "transferencia", kind: "transfer", at: now, beneficiary: t.beneficiary, context: t.context },
      `Transferencia a ${t.beneficiary}`,
      [],
    );

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand__logo" aria-hidden>
            ⛵
          </span>
          <div>
            <h1>Ulises</h1>
            <p>Tu escudo frente a la prisa: la tuya, la de la web y la de los estafadores.</p>
          </div>
        </div>
        <div className="top__controls">
          <label>
            Hora simulada
            <select value={now} onChange={(e) => setNow(e.target.value)}>
              {TIMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <span className="voice">{voice}</span>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="layout">
        <div className="main">
          {tab === "frio" && <ColdMode profile={profile} onProfile={setProfile} rules={rules} onRules={setRules} goals={goals} onGoals={setGoals} />}
          {tab === "tienda" && <Shop shieldOn={shieldOn} onShieldChange={setShieldOn} onCheckout={onCheckout} />}
          {tab === "transferencia" && <Transfer onSend={onTransfer} />}
          {tab === "pregunta" && <AskUlises userId={USER_ID} profile={profile} history={history} now={now} goals={goals} />}
          {tab === "panel" && <Dashboard log={log} />}
        </div>
        <aside className="side">
          <Thermometer result={last} />
          <div className="card small">
            <h3>{profile.name}</h3>
            <p>
              Saldo {profile.balance.toLocaleString("es-ES")} € · cobra el día {profile.payday}
            </p>
            <p className="muted">{rules.filter((r) => r.enabled).length} reglas de Ulises activas</p>
          </div>
        </aside>
      </main>

      {pending && <FrictionModal {...pending} onClose={close} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
