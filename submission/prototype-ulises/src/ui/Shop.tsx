import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DARK_PATTERN_LABEL, detectDarkPatterns } from "../core/darkPatterns";
import type { Category, DarkPatternFinding } from "../core/types";
import { scanDom } from "./scanDom";

export interface Product {
  id: string;
  name: string;
  price: number;
  category: Category;
  merchant: string;
  emoji: string;
}

export const PRODUCTS: Product[] = [
  { id: "zapas", name: "Zapatillas AirRun Pro", price: 129, category: "moda", merchant: "MegaOfertas", emoji: "👟" },
  { id: "reloj", name: "Reloj Chrono Titanium", price: 999, category: "moda", merchant: "MegaOfertas", emoji: "⌚" },
  { id: "cascos", name: "Auriculares NoiseZero", price: 59, category: "electronica", merchant: "MegaOfertas", emoji: "🎧" },
];

interface Props {
  shieldOn: boolean;
  onShieldChange: (on: boolean) => void;
  onCheckout: (product: Product, total: number, patterns: DarkPatternFinding[]) => void;
}

interface Box {
  finding: DarkPatternFinding;
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * A deliberately manipulative third-party shop. Nothing here is aware of Ulises: the shield reads
 * it through the generic DOM scanner, as a browser extension would.
 */
export function Shop({ shieldOn, onShieldChange, onCheckout }: Props) {
  const [productId, setProductId] = useState("reloj");
  const [addonChecked, setAddonChecked] = useState(true);
  const [seconds, setSeconds] = useState(299);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [findings, setFindings] = useState<DarkPatternFinding[]>([]);
  const pageRef = useRef<HTMLDivElement>(null);
  const product = PRODUCTS.find((p) => p.id === productId)!;
  const addon = 29.99;
  const fee = 4.99;
  const total = Math.round((product.price + (addonChecked ? addon : 0) + fee) * 100) / 100;

  // The "offer" restarts when it hits zero: the classic fake countdown.
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => (s <= 0 ? 299 : s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const scan = useCallback(() => {
    const root = pageRef.current;
    if (!root) return [];
    const found = detectDarkPatterns(scanDom(root));
    const origin = root.getBoundingClientRect();
    setFindings(found);
    const raw = found.flatMap((f) => {
      const el = f.ref ? root.querySelector<HTMLElement>(`[data-ulises-ref="${f.ref}"]`) : null;
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ finding: f, top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height }];
    });
    setBoxes(mergeBoxes(raw));
    return found;
  }, []);

  useLayoutEffect(() => {
    if (!shieldOn) {
      setBoxes([]);
      setFindings([]);
      return;
    }
    scan();
    window.addEventListener("resize", scan);
    return () => window.removeEventListener("resize", scan);
  }, [shieldOn, productId, addonChecked, scan]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const uniqueKinds = [...new Set(findings.map((f) => f.kind))];

  return (
    <section className="shop-wrap">
      <div className="shield-bar">
        <label className="switch">
          <input type="checkbox" checked={shieldOn} onChange={(e) => onShieldChange(e.target.checked)} />
          <span>Escudo Ulises {shieldOn ? "activado" : "desactivado"}</span>
        </label>
        {shieldOn && (
          <span className="shield-count">
            {uniqueKinds.length === 0 ? "Página limpia" : `${uniqueKinds.length} técnicas de presión detectadas`}
          </span>
        )}
      </div>

      <div className="shop" ref={pageRef}>
        <header className="shop__header">
          <span className="shop__logo">MegaOfertas</span>
          <span className="shop__flash">
            <span>¡Oferta flash!</span> <span>Termina en</span> <b className="shop__timer">{`${mm}:${ss}`}</b>
          </span>
        </header>

        <div className="shop__products">
          {PRODUCTS.map((p) => (
            <button key={p.id} className={`shop__product ${p.id === productId ? "is-selected" : ""}`} onClick={() => setProductId(p.id)}>
              <span className="shop__emoji">{p.emoji}</span>
              <span>{p.name}</span>
              <b>{p.price.toLocaleString("es-ES")} €</b>
            </button>
          ))}
        </div>

        <div className="shop__detail">
          <p className="shop__stock">
            <span>Solo quedan 2 unidades</span>
          </p>
          <p className="shop__social">
            <span>17 personas lo están viendo ahora</span>
          </p>
          <label className="shop__addon">
            <input type="checkbox" checked={addonChecked} onChange={(e) => setAddonChecked(e.target.checked)} /> Seguro de protección premium +29,99 €
          </label>
          <div className="shop__lines">
            <div>
              <span>{product.name}</span>
              <span>{product.price.toFixed(2)} €</span>
            </div>
            <div>
              <span>Gastos de gestión 4,99 €</span>
              <span>{fee.toFixed(2)} €</span>
            </div>
            <div className="shop__total">
              <span>Total</span>
              <span>{total.toFixed(2)} €</span>
            </div>
          </div>
          <button className="shop__buy" onClick={() => onCheckout(product, total, shieldOn ? scan() : [])}>
            Comprar ya
          </button>
          <button className="shop__decline">
            <span>No, prefiero pagar más y no proteger mi compra</span>
          </button>
        </div>

        {boxes.map((b, i) => (
          <div
            key={`${b.finding.kind}-${i}`}
            className={`flag flag--sev${b.finding.severity}`}
            style={{ top: b.top - 4, left: b.left - 4, width: b.width + 8, height: b.height + 8 }}
            title={b.finding.explanation}
          >
            <span className="flag__label">{DARK_PATTERN_LABEL[b.finding.kind]}</span>
          </div>
        ))}
      </div>

      {shieldOn && uniqueKinds.length > 0 && (
        <ul className="shield-list">
          {uniqueKinds.map((k) => {
            const f = findings.find((x) => x.kind === k)!;
            return (
              <li key={k}>
                <strong>{DARK_PATTERN_LABEL[k]}:</strong> {f.explanation}
                {k === "preseleccion" && addonChecked && (
                  <button className="link" onClick={() => setAddonChecked(false)}>
                    Desmarcar el extra
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** "¡Oferta flash!", "Termina en" and "04:59" are three elements but one technique: draw one box. */
function mergeBoxes(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of boxes) {
    const near = out.find(
      (o) =>
        o.finding.kind === b.finding.kind &&
        b.top < o.top + o.height &&
        o.top < b.top + b.height &&
        b.left <= o.left + o.width + 24 &&
        o.left <= b.left + b.width + 24,
    );
    if (!near) {
      out.push({ ...b });
      continue;
    }
    const right = Math.max(near.left + near.width, b.left + b.width);
    const bottom = Math.max(near.top + near.height, b.top + b.height);
    near.left = Math.min(near.left, b.left);
    near.top = Math.min(near.top, b.top);
    near.width = right - near.left;
    near.height = bottom - near.top;
  }
  return out;
}
