import { useEffect, useState } from "react";
import type { FrictionDecision, PurchaseIntent, ThermometerResult, UlisesRule } from "../core/types";
import { fetchDebate, fetchExplain, type Debate, type EvalPayload } from "./api";
import { Thermometer } from "./Thermometer";

export type Outcome = "pagado" | "en_espera" | "cancelado" | "movido_a_meta" | "bloqueado_estafa";

interface Props {
  purchase: PurchaseIntent;
  thermo: ThermometerResult;
  decision: FrictionDecision;
  payload: EvalPayload;
  onClose: (outcome: Outcome, note?: string) => void;
}

const fmt = (n: number) => `${n.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

/** One modal, five intensities. The amount of friction is decided by src/core/ulises.ts, never by the UI. */
export function FrictionModal({ purchase, thermo, decision, payload, onClose }: Props) {
  const [explanation, setExplanation] = useState<{ text: string; source: string } | null>(null);
  const [debate, setDebate] = useState<{ debate: Debate; source: string } | null>(null);
  const [shown, setShown] = useState(0);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (decision.level === 0) return;
    fetchExplain(payload).then(setExplanation).catch(() => setExplanation(null));
    if (decision.mode === "debate") fetchDebate(payload).then(setDebate).catch(() => setDebate(null));
  }, [decision, payload]);

  // Reveal the debate turn by turn, like a conversation.
  const turns = debate ? interleave(debate.debate) : [];
  useEffect(() => {
    if (shown >= turns.length) return;
    const t = setTimeout(() => setShown((s) => s + 1), shown === 0 ? 200 : 1100);
    return () => clearTimeout(t);
  }, [shown, turns.length]);

  if (decision.level === 0) return null;
  const scam = decision.mode === "escudo_estafa";
  // In front of a scam, a "does this bring you closer to Japan?" question is noise: show only rules that act.
  const shownRules = scam ? decision.matchedRules.filter((r) => r.action.type !== "pregunta") : decision.matchedRules;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="friction-title">
      <div className={`modal modal--${decision.mode}`}>
        <header>
          <p className="eyebrow">
            {fmt(purchase.amount)} · {purchase.merchant}
          </p>
          <h2 id="friction-title">{decision.title}</h2>
        </header>

        <Thermometer result={thermo} compact />

        {explanation && (
          <p className="explain">
            {explanation.text} <span className="source">{explanation.source === "claude" ? "IA" : "motor"}</span>
          </p>
        )}

        {scam && (
          <div className="scam">
            <p>
              <strong>Tu banco nunca te pedirá mover dinero a una “cuenta segura”, ni códigos por teléfono, ni que pagues con prisa.</strong>
            </p>
            <p>Si alguien está al teléfono contigo ahora mismo: cuelga. Llama tú al número que aparece detrás de tu tarjeta.</p>
          </div>
        )}

        {shownRules.length > 0 && (
          <div className="rules-hit">
            <p className="muted">Tú escribiste, en frío:</p>
            {shownRules.map((r) => (
              <blockquote key={r.id}>“{r.label}”</blockquote>
            ))}
          </div>
        )}

        {decision.mode === "debate" && (
          <div className="debate" aria-live="polite">
            {!debate && <p className="muted">Preparando las dos voces…</p>}
            {turns.slice(0, shown).map((t, i) => (
              <div key={i} className={`bubble bubble--${t.who}`}>
                <span className="who">{t.who === "demonio" ? "😈 Demonio" : "😇 Ángel"}</span>
                {t.text}
              </div>
            ))}
            {debate && shown >= turns.length && <p className="final-q">{debate.debate.pregunta_final}</p>}
          </div>
        )}

        <ul className="facts">
          {decision.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>

        <Actions decision={decision} scam={scam} verified={verified} setVerified={setVerified} onClose={onClose} />
      </div>
    </div>
  );
}

function Actions({
  decision,
  scam,
  verified,
  setVerified,
  onClose,
}: {
  decision: FrictionDecision;
  scam: boolean;
  verified: boolean;
  setVerified: (v: boolean) => void;
  onClose: Props["onClose"];
}) {
  const rule: UlisesRule | undefined = decision.mode === "regla_ulises" ? decision.matchedRules.find((r) => r.action.type !== "pregunta") : undefined;
  const question = decision.matchedRules.find((r) => r.action.type === "pregunta");
  const contactRule = decision.matchedRules.find((r) => r.action.type === "verificar_contacto");

  if (scam) {
    return (
      <div className="actions">
        {contactRule && contactRule.action.type === "verificar_contacto" && (
          <label className="verify">
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
            He hablado con {contactRule.action.contact} y está de acuerdo.
          </label>
        )}
        <button className="primary" onClick={() => onClose("bloqueado_estafa")}>
          No envío el dinero
        </button>
        <button className="ghost" disabled={!verified} onClick={() => onClose("pagado", "transferencia verificada")}>
          {verified ? "Enviar igualmente" : "Enviar (bloqueado hasta verificar)"}
        </button>
      </div>
    );
  }

  if (rule) {
    const a = rule.action;
    return (
      <div className="actions">
        {a.type === "esperar" && (
          <button className="primary" onClick={() => onClose("en_espera", `${a.hours} h`)}>
            Guardar en lista de espera {a.hours} h
          </button>
        )}
        {a.type === "mover_a_meta" && (
          <button className="primary" onClick={() => onClose("movido_a_meta", a.goal)}>
            Mover a {a.goal}
          </button>
        )}
        {a.type === "pregunta" && <p className="final-q">{a.question}</p>}
        <button className="ghost" onClick={() => onClose("pagado", "decidido tras su propia regla")}>
          Mi yo de ahora decide pagar
        </button>
        <button className="ghost" onClick={() => onClose("cancelado")}>
          Lo dejo
        </button>
      </div>
    );
  }

  return (
    <div className="actions">
      {question?.action.type === "pregunta" && <p className="final-q">{question.action.question}</p>}
      <button className="primary" onClick={() => onClose("en_espera", "24 h")}>
        Lo pienso hasta mañana
      </button>
      <button className="ghost" onClick={() => onClose("pagado")}>
        Pagar
      </button>
      <button className="ghost" onClick={() => onClose("cancelado")}>
        Lo dejo
      </button>
    </div>
  );
}

function interleave(d: Debate) {
  const out: { who: "demonio" | "angel"; text: string }[] = [];
  for (let i = 0; i < Math.max(d.demonio.length, d.angel.length); i++) {
    if (d.demonio[i]) out.push({ who: "demonio", text: d.demonio[i] });
    if (d.angel[i]) out.push({ who: "angel", text: d.angel[i] });
  }
  return out;
}
