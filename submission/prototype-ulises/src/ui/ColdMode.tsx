import { useState } from "react";
import type { Category, UlisesRule, UserProfile } from "../core/types";

const CATEGORIES: Category[] = ["moda", "electronica", "ocio", "restauracion", "apuestas", "cripto", "gaming", "flash_sales", "material_trabajo"];

interface Props {
  profile: UserProfile;
  onProfile: (p: UserProfile) => void;
  rules: UlisesRule[];
  onRules: (r: UlisesRule[]) => void;
  goals: string[];
  onGoals: (g: string[]) => void;
}

/**
 * "Modo frío": the user decides, while calm, what their future self should do in the hot moment.
 * This is the Ulysses contract: the system enforces the user's rules, not the bank's.
 */
export function ColdMode({ profile, onProfile, rules, onRules, goals, onGoals }: Props) {
  const [draft, setDraft] = useState({ minAmount: 50, from: 22, to: 7, hours: 24, category: "" as Category | "" });

  const addRule = () => {
    const cat = draft.category || undefined;
    const label = `Si gasto más de ${draft.minAmount} €${cat ? ` en ${cat}` : ""} entre las ${draft.from}:00 y las ${draft.to}:00, espérame ${draft.hours} horas.`;
    onRules([
      ...rules,
      {
        id: `r${Date.now()}`,
        label,
        enabled: true,
        when: { minAmount: draft.minAmount, hours: [draft.from, draft.to], categories: cat ? [cat] : undefined },
        action: { type: "esperar", hours: draft.hours },
      },
    ]);
  };

  const num = (k: keyof UserProfile) => (e: React.ChangeEvent<HTMLInputElement>) => onProfile({ ...profile, [k]: Number(e.target.value) });

  return (
    <div className="cold">
      <section className="card">
        <h2>1 · Tu situación</h2>
        <p className="muted">En producción esto sale de tus cuentas y se calcula en tu móvil. En la demo es editable.</p>
        <div className="form-grid">
          <label>
            Saldo disponible (€)
            <input type="number" value={profile.balance} onChange={num("balance")} />
          </label>
          <label>
            Ingresos netos al mes (€)
            <input type="number" value={profile.monthlyNetIncome} onChange={num("monthlyNetIncome")} />
          </label>
          <label>
            Día de cobro
            <input type="number" min={1} max={31} value={profile.payday} onChange={num("payday")} />
          </label>
          <label>
            Horas trabajadas al mes
            <input type="number" value={profile.monthlyWorkHours} onChange={num("monthlyWorkHours")} />
          </label>
        </div>
        <fieldset className="cats">
          <legend>Gastos de trabajo (nunca suben el termómetro)</legend>
          {CATEGORIES.map((c) => (
            <label key={c} className="chip-check">
              <input
                type="checkbox"
                checked={profile.professionalCategories.includes(c)}
                onChange={(e) =>
                  onProfile({
                    ...profile,
                    professionalCategories: e.target.checked ? [...profile.professionalCategories, c] : profile.professionalCategories.filter((x) => x !== c),
                  })
                }
              />
              {c}
            </label>
          ))}
        </fieldset>
      </section>

      <section className="card">
        <h2>2 · Lo que de verdad te importa</h2>
        <p className="muted">Las voces del debate argumentan desde aquí, no desde lo que quiere vender la tienda.</p>
        <textarea rows={2} value={goals.join("\n")} onChange={(e) => onGoals(e.target.value.split("\n").filter(Boolean))} />
      </section>

      <section className="card">
        <h2>3 · Tu contrato de Ulises</h2>
        <p className="muted">Escríbelo ahora, en frío. Cuando llegue el momento, Ulises te enseñará tus propias palabras.</p>
        <ul className="rules">
          {rules.map((r) => (
            <li key={r.id} className={r.enabled ? "" : "is-off"}>
              <label className="switch">
                <input type="checkbox" checked={r.enabled} onChange={(e) => onRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))} />
                <span>“{r.label}”</span>
              </label>
              <button className="link" onClick={() => onRules(rules.filter((x) => x.id !== r.id))} aria-label="Eliminar regla">
                Eliminar
              </button>
            </li>
          ))}
        </ul>
        <div className="rule-builder">
          <span>Si gasto más de</span>
          <input type="number" value={draft.minAmount} onChange={(e) => setDraft({ ...draft, minAmount: Number(e.target.value) })} />
          <span>€ en</span>
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Category | "" })}>
            <option value="">cualquier cosa</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span>entre las</span>
          <input type="number" min={0} max={23} value={draft.from} onChange={(e) => setDraft({ ...draft, from: Number(e.target.value) })} />
          <span>y las</span>
          <input type="number" min={0} max={24} value={draft.to} onChange={(e) => setDraft({ ...draft, to: Number(e.target.value) })} />
          <span>, espérame</span>
          <input type="number" min={1} value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: Number(e.target.value) })} />
          <span>horas.</span>
          <button className="primary" onClick={addRule}>
            Añadir regla
          </button>
        </div>
      </section>
    </div>
  );
}
