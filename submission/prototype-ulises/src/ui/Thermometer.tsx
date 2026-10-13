import type { ThermometerResult } from "../core/types";

const LEVEL_LABEL = { calma: "Calma", atencion: "Atención", alto: "Alto", critico: "Crítico" } as const;

export function Thermometer({ result, compact = false }: { result: ThermometerResult | null; compact?: boolean }) {
  const score = result?.score ?? 0;
  const level = result?.level ?? "calma";
  return (
    <div className={`thermo thermo--${level} ${compact ? "thermo--compact" : ""}`} aria-label={`Termómetro de impulso: ${score} de 100`}>
      <div className="thermo__head">
        <span className="thermo__title">Termómetro de impulso</span>
        <span className="thermo__score">
          {score}
          <small>/100</small>
        </span>
      </div>
      <div className="thermo__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
        <div className="thermo__fill" style={{ width: `${score}%` }} />
        <span className="thermo__tick" style={{ left: "35%" }} />
        <span className="thermo__tick" style={{ left: "55%" }} />
        <span className="thermo__tick" style={{ left: "75%" }} />
      </div>
      <div className="thermo__level">{result ? LEVEL_LABEL[level] : "Sin pago en curso"}</div>
      {!compact && result && result.contributions.length > 0 && (
        <ul className="thermo__signals">
          {result.contributions.map((c) => (
            <li key={c.signal}>
              <span className="pts">{c.points > 0 ? `+${c.points}` : "·"}</span>
              <span>
                <strong>{c.signal}</strong> — {c.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
