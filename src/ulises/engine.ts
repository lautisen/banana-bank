// Ulises: a pressure check that runs on every transfer proposal, before the customer can confirm it.
//
// Banks already stop payments the customer did NOT authorise (stolen cards). Ulises covers the other
// half: payments the customer authorises themselves while under pressure — a scammer on the phone
// ("move your money to a safe account"), a rushed decision, or a moment they asked in advance to be
// protected from. Everything here is deterministic and explainable: every point of the score has a
// named reason, and the model only explains these results, it never computes them.

export type UlisesLevel = 'calm' | 'attention' | 'high' | 'scam';

export type UlisesSignal = { id: string; label: string; detail: string; points: number };

export type UlisesRuleWhen = {
  minAmountCents: number | null;
  onlyNewRecipients: boolean;
  // Local hours in Europe/Madrid, [from, to). Wraps midnight when from > to.
  hoursFrom: number | null;
  hoursTo: number | null;
};

export type UlisesRule = {
  id: string;
  label: string;
  when: UlisesRuleWhen;
  holdMinutes: number;
  trustedContact: string | null;
};

export type UlisesFriction = {
  // none: confirm as usual · notice: reasons shown · acknowledge: the customer must tick that they
  // read the reasons · hold: their own rule (or the scam shield) delays confirmation until holdUntil.
  mode: 'none' | 'notice' | 'acknowledge' | 'hold';
  requiresAcknowledgement: boolean;
  holdUntil: string | null;
  matchedRules: UlisesRule[];
};

// The customer's own limits from the Ulises check (or the defaults while they have not done it).
export type UlisesLimits = {
  source: 'customer' | 'default';
  cushionCents: number;
  bigPaymentCents: number;
  monthlyIncomeCents: number | null;
  monthlySpendCents: number | null;
};

// Numbers that put the amount in the customer's own terms, for the panel's before/after view.
export type UlisesPerspective = {
  amountCents: number;
  balanceCents: number;
  leftCents: number;
  cushionCents: number | null;
  monthsOfSpending: number | null;
  shareOfIncome: number | null;
  limitsSource: UlisesLimits['source'] | null;
};

export type UlisesAssessment = {
  score: number;
  level: UlisesLevel;
  signals: UlisesSignal[];
  scamCues: string[];
  facts: string[];
  friction: UlisesFriction;
  ownAccount: boolean;
  perspective?: UlisesPerspective;
};

export type TransferFacts = {
  amountCents: number;
  concept: string;
  toAccountId: string;
  ownAccount: boolean;
  fromBalanceCents: number;
  // Absolute amounts of the customer's recent outgoing movements (bank ledger), newest first.
  recentOutgoingCents: number[];
  // Destinations of transfers this customer has completed before (application records).
  knownRecipientIds: string[];
  // Transfer proposals this customer created in the last 30 minutes, excluding this one.
  proposalsLast30Min: number;
  // The customer's own words in this conversation (not the assistant's).
  customerText: string;
  now: Date;
};

// Phrases scammers make victims repeat. Spanish and English, because customers write in both.
const SCAM_CUES: { id: string; label: string; re: RegExp }[] = [
  {
    id: 'safe_account',
    label: '"safe account" story',
    re: /(cuenta (segura|de seguridad|protegida|puente)|safe account|secure account|holding account)/,
  },
  {
    id: 'bank_called',
    label: 'someone claiming to be the bank or the police',
    re: /((me|nos) (ha|han) llamado|llamada|me llaman|me escriben).{0,40}(banco|banana|policia|guardia civil|hacienda|seguridad)|(bank|police|fraud team|security team).{0,20}(called|phoned|texted|rang) me|(called|phoned|texted) me.{0,30}(bank|police|fraud)/,
  },
  {
    id: 'urgency',
    label: 'pressure to act right now',
    re: /(urgente|ahora mismo|cuanto antes|inmediatamente|ya mismo|hoy sin falta|antes de que|right now|immediately|urgent|as soon as possible|asap|before it'?s too late)/,
  },
  {
    id: 'secrecy',
    label: 'being told to keep it secret',
    re: /(no (se lo |me lo |lo )?(digas|diga|cuentes|cuente|comentes|comente)|que no (lo sepa|se entere)|don'?t tell|keep (it|this) (secret|quiet)|not to tell)/,
  },
  {
    id: 'codes',
    label: 'being asked for codes or passwords',
    re: /\b(codigo|clave|contrasena|pin|sms)\b.{0,30}\b(me (piden|pide|han pedido)|darselo|darle|dictar|leer)\b|\b(piden|pide|pedido)\b.{0,20}\b(codigo|clave|contrasena|pin)\b|(asked|ask) (me )?for (the |my )?(code|pin|password|otp)/,
  },
  {
    id: 'guaranteed_return',
    label: 'a "guaranteed" investment',
    re: /(inversion|rentabilidad|beneficio|ganancia)s? (garantizad|asegurad|segur)|guaranteed (return|profit|investment)|double your money|duplicar (tu|mi|el) dinero/,
  },
  {
    id: 'family_new_number',
    label: 'a relative writing from a "new number"',
    re: /(mama|papa|hijo|hija|mum|mom|dad).{0,40}(movil nuevo|numero nuevo|new (phone|number))|(movil nuevo|numero nuevo|new (phone|number)).{0,40}(mama|papa|mum|mom|dad)/,
  },
  {
    id: 'blocked_account',
    label: 'a threat that the account will be blocked',
    re: /(cuenta|tarjeta) (bloquead|suspendid|cancelad)|(account|card) (will be |has been |is )?(blocked|suspended|frozen|closed)/,
  },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const eur = (cents: number) =>
  `${(cents / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;

// Customer-facing time, e.g. "24 Sept, 18:05" (Europe/Madrid).
export const madridDateTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

export const madridHour = (d: Date) =>
  Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(d),
  );

const inHours = (h: number, from: number, to: number) =>
  from <= to ? h >= from && h < to : h >= from || h < to;

export function detectScamCues(text: string): { id: string; label: string }[] {
  const t = norm(text);
  return SCAM_CUES.filter((c) => c.re.test(t)).map(({ id, label }) => ({ id, label }));
}

export function matchRules(rules: UlisesRule[], f: TransferFacts): UlisesRule[] {
  const isNew = !f.ownAccount && !f.knownRecipientIds.includes(f.toAccountId);
  const h = madridHour(f.now);
  return rules.filter((r) => {
    if (f.ownAccount) return false; // moving money between your own accounts is never held
    if (r.when.minAmountCents !== null && f.amountCents < r.when.minAmountCents) return false;
    if (r.when.onlyNewRecipients && !isNew) return false;
    if (
      r.when.hoursFrom !== null &&
      r.when.hoursTo !== null &&
      !inHours(h, r.when.hoursFrom, r.when.hoursTo)
    )
      return false;
    return true;
  });
}

export const levelFor = (score: number, scam: boolean): UlisesLevel =>
  scam ? 'scam' : score >= 55 ? 'high' : score >= 30 ? 'attention' : 'calm';

export function assess(
  f: TransferFacts,
  rules: UlisesRule[],
  scamHoldMinutes = 30,
  limits: UlisesLimits | null = null,
): UlisesAssessment {
  const signals: UlisesSignal[] = [];
  const add = (id: string, label: string, points: number, detail: string) => {
    if (points > 0) signals.push({ id, label, points, detail });
  };

  const share = f.fromBalanceCents > 0 ? f.amountCents / f.fromBalanceCents : 1;
  const left = f.fromBalanceCents - f.amountCents;
  const isNew = !f.ownAccount && !f.knownRecipientIds.includes(f.toAccountId);
  const typical = median(f.recentOutgoingCents);
  const ratio = typical > 0 ? f.amountCents / typical : 0;
  const round = f.amountCents >= 30000 && f.amountCents % 10000 === 0;
  const cues = f.ownAccount ? [] : detectScamCues(`${f.customerText}\n${f.concept}`);

  if (!f.ownAccount) {
    if (share > 0.5)
      add(
        'balance_share',
        'Large share of your balance',
        20,
        `${Math.round(share * 100)}% of the source account`,
      );
    else if (share > 0.25)
      add(
        'balance_share',
        'Large share of your balance',
        12,
        `${Math.round(share * 100)}% of the source account`,
      );
    const ownWords = limits?.source === 'customer';
    if (limits && left < limits.cushionCents)
      add(
        'below_cushion',
        'Leaves you below your safety cushion',
        12,
        `${eur(Math.max(0, left))} would remain; ${ownWords ? 'you asked to always keep' : 'default cushion'} ${eur(limits.cushionCents)}`,
      );
    else if (!limits && left >= 0 && left < Math.max(5000, f.fromBalanceCents * 0.1))
      add('near_empty', 'Leaves the account almost empty', 10, `${eur(left)} would remain`);
    if (limits && f.amountCents >= limits.bigPaymentCents)
      add(
        'big_for_you',
        ownWords ? 'Above what you call a big payment' : 'A big payment',
        8,
        `${ownWords ? 'your line' : 'default line'}: ${eur(limits.bigPaymentCents)}`,
      );
    if (ratio > 10)
      add(
        'unusual_amount',
        'Much larger than your usual payments',
        18,
        `${ratio.toFixed(0)}× your typical payment (${eur(typical)})`,
      );
    else if (ratio > 4)
      add(
        'unusual_amount',
        'Larger than your usual payments',
        10,
        `${ratio.toFixed(1)}× your typical payment (${eur(typical)})`,
      );
    if (isNew)
      add(
        'new_recipient',
        'New recipient',
        15,
        'you have never completed a transfer to this account',
      );
    if (round) add('round_amount', 'Round amount', 6, 'scams usually ask for round figures');
    if (f.proposalsLast30Min >= 2)
      add(
        'burst',
        'Several transfers in a row',
        10,
        `${f.proposalsLast30Min} other proposals in the last 30 minutes`,
      );
    if (cues.length)
      add(
        'scam_script',
        'Words typical of a scam script',
        25 + 5 * (cues.length - 1),
        cues.map((c) => c.label).join('; '),
      );
  }

  // "Scam" needs evidence of a script, not just a big number: a large round payment to someone new
  // (a flat deposit, say) is often legitimate, so on its own it raises the score but holds nothing.
  const scam = isNew && cues.length > 0;
  let score = Math.min(
    100,
    signals.reduce((a, s) => a + s.points, 0),
  );
  if (scam) score = Math.max(score, 80);
  const level = levelFor(score, scam);

  const matchedRules = matchRules(rules, f);
  const holdMinutes = Math.max(
    scam ? scamHoldMinutes : 0,
    ...matchedRules.map((r) => r.holdMinutes),
  );
  const holdUntil =
    holdMinutes > 0 ? new Date(f.now.getTime() + holdMinutes * 60_000).toISOString() : null;
  const requiresAcknowledgement = level === 'high' || level === 'scam' || matchedRules.length > 0;
  const mode: UlisesFriction['mode'] = holdUntil
    ? 'hold'
    : requiresAcknowledgement
      ? 'acknowledge'
      : level === 'attention'
        ? 'notice'
        : 'none';

  const facts: string[] = [];
  if (!f.ownAccount) {
    facts.push(`After this transfer the source account would hold ${eur(Math.max(0, left))}.`);
    facts.push('A completed transfer to another person usually cannot be reversed.');
    if (scam)
      facts.push(
        'Banana Bank never asks customers to move money to a "safe account" or to share codes.',
      );
  }

  return {
    score,
    level,
    signals: signals.sort((a, b) => b.points - a.points),
    scamCues: cues.map((c) => c.id),
    facts,
    friction: { mode, requiresAcknowledgement, holdUntil, matchedRules },
    ownAccount: f.ownAccount,
    perspective: {
      amountCents: f.amountCents,
      balanceCents: f.fromBalanceCents,
      leftCents: left,
      cushionCents: limits?.cushionCents ?? null,
      monthsOfSpending: limits?.monthlySpendCents
        ? Math.round((f.amountCents / limits.monthlySpendCents) * 10) / 10
        : null,
      shareOfIncome: limits?.monthlyIncomeCents
        ? Math.round((f.amountCents / limits.monthlyIncomeCents) * 100) / 100
        : null,
      limitsSource: limits?.source ?? null,
    },
  };
}
