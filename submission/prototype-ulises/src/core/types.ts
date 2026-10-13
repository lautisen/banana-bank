export type Category =
  | "supermercado"
  | "hogar"
  | "transporte"
  | "restauracion"
  | "moda"
  | "electronica"
  | "ocio"
  | "suscripciones"
  | "apuestas"
  | "cripto"
  | "flash_sales"
  | "gaming"
  | "salud"
  | "material_trabajo"
  | "transferencia";

export interface Transaction {
  id: string;
  /** ISO timestamp. */
  at: string;
  amount: number;
  merchant: string;
  category: Category;
  kind: "card" | "transfer";
}

export interface UserProfile {
  name: string;
  monthlyNetIncome: number;
  /** Day of month the salary arrives (1-31). */
  payday: number;
  balance: number;
  /** Paid hours per month, to express prices as hours of work. */
  monthlyWorkHours: number;
  /** Categories that are part of the user's job and must never raise the score. */
  professionalCategories: Category[];
  knownBeneficiaries: string[];
}

export interface PurchaseIntent {
  amount: number;
  merchant: string;
  category: Category;
  kind: "card" | "transfer";
  at: string;
  /** Transfers only: destination account (IBAN or alias). */
  beneficiary?: string;
  /** Free text the user saw or typed, e.g. the transfer concept. */
  context?: string;
}

export type DarkPatternKind =
  | "falsa_urgencia"
  | "falsa_escasez"
  | "presion_social"
  | "preseleccion"
  | "confirmshaming"
  | "coste_oculto"
  | "suscripcion_encubierta";

export interface PageElement {
  text: string;
  /** Present for checkboxes / toggles. */
  checked?: boolean;
  isTimer?: boolean;
  /** Stable reference so the UI can highlight the element. */
  ref?: string;
}

export interface DarkPatternFinding {
  kind: DarkPatternKind;
  severity: 1 | 2 | 3;
  evidence: string;
  explanation: string;
  ref?: string;
}

export interface Contribution {
  signal: string;
  points: number;
  detail: string;
}

export type ThermometerLevel = "calma" | "atencion" | "alto" | "critico";

export interface ThermometerResult {
  score: number;
  level: ThermometerLevel;
  contributions: Contribution[];
  scamRisk: boolean;
  /** Days of usual spending the balance covers after paying. */
  cushionDaysAfter: number;
  daysToPayday: number;
  hoursOfWork: number;
}

export type UlisesAction =
  | { type: "esperar"; hours: number }
  | { type: "pregunta"; question: string }
  | { type: "mover_a_meta"; goal: string }
  | { type: "verificar_contacto"; contact: string };

export interface UlisesRule {
  id: string;
  /** The rule as the user wrote it, shown back verbatim at the hot moment. */
  label: string;
  enabled: boolean;
  when: {
    categories?: Category[];
    minAmount?: number;
    /** Local hours [from, to). Wraps around midnight when from > to. */
    hours?: [number, number];
    minScore?: number;
    newBeneficiary?: boolean;
  };
  action: UlisesAction;
}

export type FrictionLevel = 0 | 1 | 2 | 3 | 4;

export interface FrictionDecision {
  level: FrictionLevel;
  mode: "sin_friccion" | "aviso" | "debate" | "regla_ulises" | "escudo_estafa";
  title: string;
  matchedRules: UlisesRule[];
  facts: string[];
}
