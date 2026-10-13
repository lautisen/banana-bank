import type { ThermometerLevel } from "../core/types";
import type { Outcome } from "./FrictionModal";

export interface LogEntry {
  at: string;
  what: string;
  amount: number;
  score: number;
  level: ThermometerLevel;
  mode: string;
  outcome: Outcome;
  note?: string;
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  pagado: "Pagado",
  en_espera: "En lista de espera",
  cancelado: "Descartado",
  movido_a_meta: "Movido a la meta",
  bloqueado_estafa: "Estafa frenada",
};

export function Dashboard({ log }: { log: LogEntry[] }) {
  const protectedEur = log.filter((l) => l.outcome !== "pagado").reduce((a, l) => a + l.amount, 0);
  const impulses = log.filter((l) => l.mode !== "sin_friccion" && l.mode !== "escudo_estafa" && l.outcome !== "pagado").length;
  const scams = log.filter((l) => l.outcome === "bloqueado_estafa").length;
  const frictionless = log.filter((l) => l.mode === "sin_friccion").length;

  return (
    <section className="card">
      <h2>Lo que Ulises ha hecho por ti</h2>
      <div className="stats">
        <div>
          <b>{protectedEur.toLocaleString("es-ES", { maximumFractionDigits: 2 })} €</b>
          <span>protegidos</span>
        </div>
        <div>
          <b>{impulses}</b>
          <span>impulsos frenados</span>
        </div>
        <div>
          <b>{scams}</b>
          <span>estafas interceptadas</span>
        </div>
        <div>
          <b>{frictionless}</b>
          <span>pagos sin fricción</span>
        </div>
      </div>
      {log.length === 0 ? (
        <p className="muted">Aún no hay pagos. Prueba la tienda o la transferencia.</p>
      ) : (
        <table className="log">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Pago</th>
              <th>Termómetro</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {[...log].reverse().map((l, i) => (
              <tr key={i}>
                <td>{l.at.slice(11, 16)}</td>
                <td>
                  {l.what} · {l.amount.toLocaleString("es-ES")} €
                </td>
                <td>
                  <span className={`pill pill--${l.level}`}>{l.score}</span>
                </td>
                <td>
                  {OUTCOME_LABEL[l.outcome]}
                  {l.note ? ` (${l.note})` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
