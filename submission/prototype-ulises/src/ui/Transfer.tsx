import { useState } from "react";

interface Preset {
  label: string;
  beneficiary: string;
  amount: number;
  context: string;
}

const PRESETS: Preset[] = [
  { label: "Alquiler al casero", beneficiary: "Casero - Alquiler", amount: 600, context: "Alquiler octubre" },
  {
    label: "Llamada del “banco”",
    beneficiary: "ES76 2100 9999 1234 5678 9012",
    amount: 2000,
    context: "Me llaman de mi banco: han detectado un ataque y tengo que mover el dinero a una cuenta segura urgente",
  },
  { label: "Mensaje de un “hijo”", beneficiary: "ES12 1465 0100 9988 7766 5544", amount: 450, context: "Mamá, se me rompió el móvil, es mi número nuevo, págame esta factura" },
];

export function Transfer({ onSend }: { onSend: (t: { beneficiary: string; amount: number; context: string }) => void }) {
  const [form, setForm] = useState<Preset>(PRESETS[1]);
  return (
    <section className="card">
      <h2>Transferencia inmediata</h2>
      <p className="muted">
        Las estafas de pago autorizado no rompen ninguna contraseña: <strong>fabrican prisa</strong>. El mismo termómetro que detecta un impulso detecta
        a alguien empujándote a pagar.
      </p>
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.label} className={`chip ${form.label === p.label ? "is-on" : ""}`} onClick={() => setForm(p)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label>
          Cuenta de destino
          <input value={form.beneficiary} onChange={(e) => setForm({ ...form, beneficiary: e.target.value })} />
        </label>
        <label>
          Importe (€)
          <input type="number" min={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
        </label>
        <label className="span2">
          Concepto / qué te han dicho
          <textarea rows={2} value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} />
        </label>
      </div>
      <button className="primary" onClick={() => onSend(form)}>
        Enviar ahora
      </button>
    </section>
  );
}
