'use client';
import { useEffect, useRef, useState } from 'react';
import { parseAmountCents } from '../src/amount';

type AnyRecord = Record<string, any>;
type Api = (path: string, body?: unknown) => Promise<any>;
const money = (cents: number, digits = 2) =>
  new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
const whole = (cents: number) => money(cents, 0);
const when = (value: string) =>
  new Intl.DateTimeFormat('en-IE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
const round50 = (cents: number) => Math.max(5000, Math.round(cents / 5000) * 5000);
const minutesText = (m: number) =>
  m === 0
    ? 'no wait, just a warning'
    : m >= 1440
      ? `${m / 1440} day${m === 1440 ? '' : 's'}`
      : m >= 60
        ? `${m / 60} hour${m === 60 ? '' : 's'}`
        : `${m} minutes`;
// Free-text answers: "800", "1,250", "1.5k", or "3 months" (of spending) when spending is known.
function readAmount(text: string, monthlySpendCents?: number | null) {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[€\s]|eur(os)?/g, ' ')
    .trim();
  const months = t.match(/^(\d+(?:[.,]\d+)?)\s*(months?|meses|mes)\b/);
  if (months)
    return monthlySpendCents
      ? Math.round(Number(months[1].replace(',', '.')) * monthlySpendCents)
      : null;
  const k = t.match(/^(\d+(?:[.,]\d+)?)\s*k$/);
  if (k) return Math.round(Number(k[1].replace(',', '.')) * 100000);
  return parseAmountCents(t.replace(/\s+/g, ''));
}
const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

// ---------------------------------------------------------------------------------------------
// The Ulises check: a short, chat-like questionnaire. Answers are chips; anything can be typed.
// ---------------------------------------------------------------------------------------------

type Values = {
  monthlyIncomeCents: number | null;
  monthlySpendCents: number | null;
  cushionCents: number;
  bigPaymentCents: number;
  newRecipientHoldMinutes: number;
  quietHours: { from: number; to: number } | null;
  trustedContact: string | null;
};
type Option = { label: string; value: unknown };
type Note = { at: number; from: 'me' | 'ulises'; text: string };
type Offer = {
  suggestions: { id: string; value: number | string | null; why: string; label: string }[];
  proposal: { label: string; value: number | string | null } | null;
};
const looksLikeQuestion = (t: string) =>
  /\?|^\s*(what|how|should|which|why|help|que|qué|cuanto|cuánto|como|cómo|deberia|debería|cual|cuál|por ?que|por ?qué|ayuda)/i.test(
    t,
  );
type Step = {
  key: keyof Values | 'intro';
  ask: (v: Values) => string;
  options: (v: Values) => Option[];
  input?: 'amount' | 'text';
  placeholder?: string;
};

function steps(profile: AnyRecord): Step[] {
  const detectedIncome: number | null = profile.detected?.monthlyIncomeCents ?? null;
  const income = (v: Values) => v.monthlyIncomeCents ?? detectedIncome;
  return [
    {
      key: 'intro',
      ask: () =>
        'Hi, I’m Ulises ⛵. Ulysses had himself tied to the mast before passing the Sirens. Same idea: you set your limits now, while calm, and I hold you to them when a payment feels urgent. Five quick questions.',
      options: () => [{ label: 'Let’s start', value: true }],
    },
    {
      key: 'monthlySpendCents',
      ask: (v) =>
        income(v)
          ? `About ${whole(income(v)!)} comes in each month, judging by your salary. Roughly how much goes out: rent, bills, food, everything?`
          : 'Roughly how much goes out every month, all in: rent, bills, food, everything?',
      options: (v) => {
        const base = income(v);
        return [
          ...(base
            ? [0.5, 0.7, 0.9].map((r) => ({
                label: `About ${whole(round50(base * r))}`,
                value: round50(base * r),
              }))
            : []),
          { label: 'Not sure, estimate it', value: null },
        ];
      },
      input: 'amount',
      placeholder: 'Another amount, e.g. 1.5k',
    },
    {
      key: 'cushionCents',
      ask: () =>
        'What is the least you always want to keep in your account, whatever happens? That’s your safety cushion.',
      options: (v) => [
        { label: whole(30000), value: 30000 },
        { label: whole(50000), value: 50000 },
        { label: whole(100000), value: 100000 },
        ...(v.monthlySpendCents
          ? [
              {
                label: `1 month of spending (${whole(v.monthlySpendCents)})`,
                value: v.monthlySpendCents,
              },
              {
                label: `3 months (${whole(v.monthlySpendCents * 3)})`,
                value: v.monthlySpendCents * 3,
              },
            ]
          : []),
      ],
      input: 'amount',
      placeholder: 'Another amount, or e.g. “2 months”',
    },
    {
      key: 'bigPaymentCents',
      ask: () => 'From what amount does a payment feel big to you?',
      options: () =>
        [10000, 30000, 50000, 100000].map((c) => ({ label: `${whole(c)} or more`, value: c })),
      input: 'amount',
      placeholder: 'Another amount, e.g. 1.5k',
    },
    {
      key: 'newRecipientHoldMinutes',
      ask: (v) =>
        `When a payment of ${whole(v.bigPaymentCents)} or more goes to someone you have never paid, should I make you wait before it can be sent?`,
      options: () => [
        { label: 'No, just warn me', value: 0 },
        { label: '30 minutes', value: 30 },
        { label: '2 hours', value: 120 },
        { label: 'Until tomorrow', value: 1440 },
      ],
      input: 'text',
    },
    {
      key: 'trustedContact',
      ask: () =>
        'Last one: who would you call before a big payment? I’ll remind you of them when it matters.',
      options: () => [{ label: 'Skip', value: null }],
      input: 'text',
      placeholder: 'e.g. my sister Ana',
    },
  ];
}

// Income is read from the salary and quiet hours are set through the chat, so neither is asked;
// both still show here so the customer sees everything Ulises will use.
const summaryLines = (v: Values, detectedIncome: number | null) => [
  [
    'Comes in each month',
    v.monthlyIncomeCents
      ? money(v.monthlyIncomeCents)
      : detectedIncome
        ? `${money(detectedIncome)} (your salary)`
        : 'not known',
  ],
  [
    'Goes out each month',
    v.monthlySpendCents ? money(v.monthlySpendCents) : 'estimated from activity',
  ],
  ['Safety cushion', money(v.cushionCents)],
  ['A big payment is', `${money(v.bigPaymentCents)} or more`],
  ['Big payment to someone new', minutesText(v.newRecipientHoldMinutes)],
  ['Call before a big payment', v.trustedContact || 'nobody set'],
  ...(v.quietHours ? [['Quiet hours', `${hh(v.quietHours.from)}–${hh(v.quietHours.to)}`]] : []),
];

// The check in progress is saved on the server after every answer, like a chat, so closing the
// window, reloading or switching device never loses it. A copy in this browser covers the moment
// the server cannot be reached; whichever copy is newer wins.
type Draft = { values: Values; answers: string[]; asked: string[]; notes?: Note[]; at: number };
const draftKey = (userId: string) => `ulises-check:${userId}`;
function localDraft(userId: string): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(userId)) || 'null');
    return d && Array.isArray(d.answers) && typeof d.at === 'number' ? d : null;
  } catch {
    return null;
  }
}
function storeLocal(userId: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(draftKey(userId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(userId));
  } catch {}
}
function newestDraft(userId: string, server: AnyRecord | null, steps: number): Draft | null {
  const remote: Draft | null = server
    ? {
        values: server.values,
        answers: server.answers,
        asked: server.asked,
        notes: server.notes ?? [],
        at: Date.parse(server.updatedAt),
      }
    : null;
  const local = localDraft(userId);
  const d = remote && (!local || remote.at >= local.at) ? remote : local;
  return d && d.answers.length <= steps && d.asked.length === d.answers.length ? d : null;
}
type Sync = 'idle' | 'saving' | 'saved' | 'offline';

export function UlisesCheck({
  userId,
  profile,
  serverDraft,
  api,
  onClose,
  onSaved,
}: {
  userId: string;
  profile: AnyRecord;
  serverDraft: AnyRecord | null;
  api: Api;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const all = steps(profile);
  const start: Values = {
    monthlyIncomeCents: profile.monthlyIncomeCents ?? null,
    monthlySpendCents: profile.monthlySpendCents ?? null,
    cushionCents: profile.cushionCents,
    bigPaymentCents: profile.bigPaymentCents,
    newRecipientHoldMinutes: profile.newRecipientHoldMinutes,
    quietHours: profile.quietHours,
    trustedContact: profile.trustedContact,
  };
  const [saved] = useState(() => newestDraft(userId, serverDraft, all.length));
  const [sync, setSync] = useState<Sync>(saved ? 'saved' : 'idle');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const first = useRef(true);
  const [values, setValues] = useState<Values>(saved?.values ?? start);
  const [answers, setAnswers] = useState<string[]>(saved?.answers ?? []);
  // Each question's wording is frozen once answered, so later answers never rewrite earlier ones.
  const [asked, setAsked] = useState<string[]>(saved?.asked ?? []);
  // What the customer asked inside a question and what Ulises replied; saved with the answers.
  const [notes, setNotes] = useState<Note[]>(saved?.notes ?? []);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<AnyRecord | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const index = answers.length;
  const step = all[index];
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [index, result, notes.length, thinking]);
  // Every answer goes to the server straight away. Saves run one after another so an older one
  // can never land after a newer one.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (result) return;
    const draft = { values, answers, asked, notes };
    storeLocal(userId, answers.length ? { ...draft, at: Date.now() } : null);
    setSync('saving');
    queue.current = queue.current
      .then(() =>
        api(
          answers.length ? 'ulises/check-draft' : 'ulises/check-draft/clear',
          answers.length ? draft : {},
        ),
      )
      .then(() => setSync('saved'))
      .catch(() => setSync('offline'));
  }, [userId, answers, notes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function answer(label: string, value: unknown) {
    setProblem('');
    setDraft('');
    setOffer(null);
    if (step.key !== 'intro') setValues((v) => ({ ...v, [step.key]: value }));
    setAsked((a) => [...a, step.ask(values)]);
    setAnswers((a) => [...a, label]);
  }
  // Clear answers are taken as they are; anything else (a question, an answer in words) goes to
  // Ulises, who explains and offers figures computed from the customer's own numbers.
  function submitDraft() {
    const t = draft.trim();
    if (!step?.input || !t || thinking) return;
    if (step.input === 'amount') {
      const cents = readAmount(t, values.monthlySpendCents ?? profile.effective?.monthlySpendCents);
      if (cents && !looksLikeQuestion(t)) return answer(whole(cents), cents);
    } else if (step.key === 'trustedContact' && !looksLikeQuestion(t) && t.split(/\s+/).length <= 6)
      return answer(t, t.slice(0, 80));
    ask(t);
  }
  async function ask(message: string) {
    const at = index;
    setDraft('');
    setProblem('');
    setOffer(null);
    setNotes((n) => [...n, { at, from: 'me', text: message }]);
    setThinking(true);
    try {
      const r = await api('ulises/check-ask', { step: step.key, message, values });
      setNotes((n) => [...n, { at, from: 'ulises', text: r.reply }]);
      setOffer({ suggestions: r.suggestions ?? [], proposal: r.proposal ?? null });
    } catch {
      setNotes((n) => [
        ...n,
        {
          at,
          from: 'ulises',
          text: 'I can’t think that through right now. Pick one of the options below.',
        },
      ]);
    } finally {
      setThinking(false);
    }
  }
  const suggestionLabel = (o: Offer['suggestions'][number]) =>
    typeof o.value === 'number' && step?.key !== 'newRecipientHoldMinutes'
      ? `${whole(o.value)}${step?.key === 'bigPaymentCents' ? ' or more' : ''} · ${o.why}`
      : o.label;
  async function save() {
    setSaving(true);
    setProblem('');
    try {
      const r = await api('ulises/profile', values);
      storeLocal(userId, null);
      setResult(r);
      onSaved(r.message);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ulises-check-backdrop" onClick={() => index === 0 && onClose()}>
      <div
        className="ulises-check"
        role="dialog"
        aria-modal="true"
        aria-label="Ulises check"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ulises-check-head">
          <span className="ulises-avatar" aria-hidden="true">
            ⛵
          </span>
          <div>
            <strong>Ulises check</strong>
            <small>
              {result
                ? 'Done'
                : !step
                  ? 'Review'
                  : index === 0
                    ? 'Five quick questions'
                    : `Question ${index} of ${all.length - 1}`}
              {!result && sync !== 'idle' && (
                <span className={`ulises-sync is-${sync}`}>
                  {' · '}
                  {sync === 'saving'
                    ? 'Saving…'
                    : sync === 'saved'
                      ? 'Saved'
                      : 'Saved on this device only'}
                </span>
              )}
            </small>
          </div>
          <button className="ulises-check-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="ulises-check-progress" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (index / all.length) * 100)}%` }} />
        </div>
        <div className="ulises-thread">
          {all.slice(0, index + 1).map((s, i) => (
            <div key={s.key}>
              {saved && saved.answers.length > 0 && i === saved.answers.length && (
                <p className="ulises-resumed">Welcome back · picking up where you left off</p>
              )}
              <div className="ulises-say">
                <span className="ulises-avatar small" aria-hidden="true">
                  ⛵
                </span>
                <p>{i < index ? asked[i] : s.ask(values)}</p>
              </div>
              {notes
                .filter((n) => n.at === i)
                .map((n, j) =>
                  n.from === 'me' ? (
                    <div key={j} className="ulises-me is-question">
                      {n.text}
                    </div>
                  ) : (
                    <div key={j} className="ulises-say">
                      <span className="ulises-avatar small" aria-hidden="true">
                        ⛵
                      </span>
                      <p>{n.text}</p>
                    </div>
                  ),
                )}
              {i === index && thinking && (
                <div className="ulises-say">
                  <span className="ulises-avatar small" aria-hidden="true">
                    ⛵
                  </span>
                  <p className="ulises-thinking" aria-label="Ulises is thinking">
                    <i />
                    <i />
                    <i />
                  </p>
                </div>
              )}
              {answers[i] && <div className="ulises-me">{answers[i]}</div>}
            </div>
          ))}
          {!step && !result && (
            <div className="ulises-say">
              <span className="ulises-avatar small" aria-hidden="true">
                ⛵
              </span>
              <div className="ulises-contract">
                <p>Here is your contract with yourself. I’ll apply it to every new transfer.</p>
                <dl>
                  {summaryLines(values, profile.detected?.monthlyIncomeCents ?? null).map(
                    ([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ),
                  )}
                </dl>
                <small>
                  You can tighten these any time. Loosening them takes 24 hours to apply, so nobody
                  can talk you out of them in a hurry.
                </small>
              </div>
            </div>
          )}
          {result && (
            <div className="ulises-say">
              <span className="ulises-avatar small" aria-hidden="true">
                ⛵
              </span>
              <p>
                {result.message}
                {result.status === 'pending' && ` New limits from ${when(result.effectiveAt)}.`}
              </p>
            </div>
          )}
          <div ref={end} />
        </div>
        <div className="ulises-check-foot">
          {problem && (
            <p className="ulises-check-problem" role="alert">
              {problem}
            </p>
          )}
          {step && (
            <>
              {offer?.proposal ? (
                <div className="ulises-chips">
                  <button
                    className="primary-chip"
                    onClick={() => answer(offer.proposal!.label, offer.proposal!.value)}
                  >
                    Yes, keep it
                  </button>
                  <button onClick={() => setOffer(null)}>No, let me choose</button>
                </div>
              ) : (
                <>
                  {offer && offer.suggestions.length > 0 && (
                    <div className="ulises-chips is-suggested" aria-label="Ulises suggests">
                      {offer.suggestions.map((o) => (
                        <button
                          key={o.id}
                          className="suggested-chip"
                          onClick={() => answer(suggestionLabel(o), o.value)}
                        >
                          {suggestionLabel(o)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="ulises-chips">
                    {step.options(values).map((o) => (
                      <button key={o.label} onClick={() => answer(o.label, o.value)}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {step.input && (
                <form
                  className="ulises-check-input"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitDraft();
                  }}
                >
                  <input
                    aria-label="Your answer, or a question for Ulises"
                    placeholder={`${step.placeholder ?? 'Type your answer'}, or ask “what would you suggest?”`}
                    maxLength={300}
                    disabled={thinking}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button className="secondary-button" disabled={!draft.trim() || thinking}>
                    Send
                  </button>
                </form>
              )}
            </>
          )}
          {!step && !result && (
            <div className="ulises-chips">
              <button className="primary-chip" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save my limits'}
              </button>
              <button
                onClick={() => {
                  setAnswers(answers.slice(0, 1));
                  setAsked(asked.slice(0, 1));
                  setNotes([]);
                  setOffer(null);
                  setValues(start);
                }}
              >
                Start over
              </button>
            </div>
          )}
          {result && (
            <div className="ulises-chips">
              <button className="primary-chip" onClick={onClose}>
                Done
              </button>
            </div>
          )}
          {index > 1 && step && (
            <button
              className="ulises-back"
              onClick={() => {
                setAnswers((a) => a.slice(0, -1));
                setAsked((a) => a.slice(0, -1));
                setNotes((n) => n.filter((x) => x.at < index));
                setOffer(null);
                setProblem('');
              }}
            >
              ← Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Overview card: what Ulises protects you with today, and the way into the check.
// ---------------------------------------------------------------------------------------------

export function UlisesHome({
  profile,
  rules,
  busy,
  onOpenCheck,
  onRemoveRule,
}: {
  profile: AnyRecord | undefined;
  rules: AnyRecord[];
  busy: boolean;
  onOpenCheck: () => void;
  onRemoveRule: (id: string) => void;
}) {
  const custom = profile?.source === 'customer';
  return (
    <section className={`panel ulises-home ${custom ? '' : 'is-default'}`} aria-label="Ulises">
      <div className="ulises-home-head">
        <span className="ulises-avatar" aria-hidden="true">
          ⛵
        </span>
        <div>
          <span className="eyebrow">ULISES · PAYMENT PROTECTION</span>
          <h2>{custom ? 'Your limits, set while calm' : 'Ulises is on default limits'}</h2>
        </div>
      </div>
      {!custom && (
        <p className="ulises-home-pitch">
          Take the two-minute check so Ulises knows your cushion, what a big payment means to you
          and when to make you wait. Until then it uses sensible defaults.
        </p>
      )}
      {profile && (
        <div className="ulises-limits">
          <div>
            <small>Safety cushion</small>
            <b>{whole(profile.cushionCents)}</b>
          </div>
          <div>
            <small>Big payment</small>
            <b>{whole(profile.bigPaymentCents)}+</b>
          </div>
          <div>
            <small>New recipient</small>
            <b>
              {profile.newRecipientHoldMinutes
                ? `wait ${minutesText(profile.newRecipientHoldMinutes)}`
                : 'warn'}
            </b>
          </div>
          {profile.quietHours && (
            <div>
              <small>Quiet hours</small>
              <b>
                {hh(profile.quietHours.from)}–{hh(profile.quietHours.to)}
              </b>
            </div>
          )}
        </div>
      )}
      {profile?.pending && (
        <p className="muted">
          Looser limits requested · they apply from {when(profile.pending.effectiveAt)}.
        </p>
      )}
      <button className={custom ? 'text-button' : 'primary-button'} onClick={onOpenCheck}>
        {custom ? 'Review my limits' : 'Start my Ulises check · 2 min'}
      </button>
      {rules.length > 0 && (
        <div className="ulises-home-rules">
          <small className="muted">Rules you dictated to the assistant</small>
          {rules.map((r) => (
            <div key={r.id} className="ulises-rule-row">
              <p>“{r.label}”</p>
              {r.removalEffectiveAt ? (
                <small>Removal requested · active until {when(r.removalEffectiveAt)}</small>
              ) : (
                <button className="text-button" disabled={busy} onClick={() => onRemoveRule(r.id)}>
                  Request removal (takes effect after a delay)
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="muted small-print">
        Or ask the assistant: “if I ever send more than 300 euros to someone new, make me wait an
        hour”.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The panel on each transfer proposal.
// ---------------------------------------------------------------------------------------------

const levelText: Record<string, [string, string]> = {
  calm: ['Calm', 'Looks like an everyday payment.'],
  attention: [
    'Worth a second look',
    'A couple of things are unusual. Have a look before you send it.',
  ],
  high: ['High pressure', 'Several signs of pressure at once. Take a minute before deciding.'],
  scam: ['Signs of a scam', 'Stop here. This matches a common scam script.'],
};
export const ulisesLevel = Object.fromEntries(Object.entries(levelText).map(([k, v]) => [k, v[0]]));

function BalanceBar({ p }: { p: AnyRecord }) {
  const total = Math.max(p.balanceCents, p.amountCents, 1);
  const left = Math.max(0, p.leftCents);
  const cushionAt = p.cushionCents !== null ? Math.min(100, (p.cushionCents / total) * 100) : null;
  const under = p.cushionCents !== null && p.leftCents < p.cushionCents;
  return (
    <div className="ulises-balance">
      <div className="ulises-balance-labels">
        <span>
          <small>Now</small>
          <b>{money(p.balanceCents)}</b>
        </span>
        <span className="arrow" aria-hidden="true">
          →
        </span>
        <span>
          <small>After this payment</small>
          <b className={under ? 'is-under' : ''}>{p.leftCents < 0 ? 'Not enough' : money(left)}</b>
        </span>
      </div>
      <div
        className="ulises-balance-bar"
        role="img"
        aria-label={`Balance ${money(p.balanceCents)}, ${money(left)} would remain${
          p.cushionCents !== null ? `, cushion ${money(p.cushionCents)}` : ''
        }`}
      >
        <span className="keep" style={{ width: `${(left / total) * 100}%` }} />
        <span
          className="leave"
          style={{ width: `${(Math.min(p.amountCents, total) / total) * 100}%` }}
        />
        {cushionAt !== null && (
          <i className="cushion" style={{ left: `${cushionAt}%` }}>
            <em>
              {p.limitsSource === 'customer' ? 'Your cushion' : 'Default cushion'}{' '}
              {whole(p.cushionCents)}
            </em>
          </i>
        )}
      </div>
    </div>
  );
}

export function UlisesPanel({
  u,
  acknowledged,
  onAcknowledge,
  onOpenCheck,
}: {
  u: AnyRecord;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
  onOpenCheck: () => void;
}) {
  const held = u.friction.holdUntil && Date.parse(u.friction.holdUntil) > Date.now();
  const p = u.perspective;
  const maxPoints = Math.max(25, ...u.signals.map((s: AnyRecord) => s.points));
  const [title, verdict] = levelText[u.level];
  return (
    <div className={`ulises ulises-${u.level}`} aria-label="Ulises payment check">
      <div className="ulises-head">
        <span className="ulises-avatar" aria-hidden="true">
          ⛵
        </span>
        <div className="ulises-title">
          <span className="ulises-brand">Ulises</span>
          <span className="ulises-pill">{title}</span>
          <p className="ulises-verdict">{verdict}</p>
        </div>
        <div
          className="ulises-gauge"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={u.score}
          aria-label="Pressure score"
        >
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="15.5" className="track" />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              className="value"
              strokeDasharray={`${(u.score / 100) * 97.4} 97.4`}
            />
          </svg>
          <b>{u.score}</b>
          <small>/100</small>
        </div>
      </div>

      {u.level === 'scam' && (
        <p className="ulises-alert">
          Banana Bank will never ask you to move money to a “safe account” or to share codes. If
          someone is on the phone with you now, hang up and call the number on your card.
          {u.incidentId && ' A support agent has been notified.'}
        </p>
      )}

      {p && !u.ownAccount && (
        <>
          <BalanceBar p={p} />
          {(p.monthsOfSpending !== null || p.shareOfIncome !== null) && (
            <div className="ulises-perspective">
              {p.monthsOfSpending !== null && (
                <span>
                  <b>{p.monthsOfSpending.toLocaleString('en-IE')}</b> months of your usual spending
                </span>
              )}
              {p.shareOfIncome !== null && (
                <span>
                  <b>{Math.round(p.shareOfIncome * 100)}%</b> of a month’s income
                </span>
              )}
            </div>
          )}
        </>
      )}

      {u.signals.length > 0 && (
        <>
          <h4 className="ulises-sub">Why Ulises flags it</h4>
          <ul className="ulises-reasons">
            {u.signals.map((s: AnyRecord) => (
              <li key={s.id}>
                <span className="pts">+{s.points}</span>
                <div>
                  <b>{s.label}</b>
                  <small>{s.detail}</small>
                </div>
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${(s.points / maxPoints) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {u.friction.matchedRules.map((r: AnyRecord) => (
        <blockquote key={r.id} className="ulises-rule">
          <small>You wrote, while calm:</small>“{r.label}”
          {r.trustedContact && <small>Reminder: talk to {r.trustedContact} first.</small>}
        </blockquote>
      ))}

      {u.facts.length > 0 && (
        <ul className="ulises-facts">
          {u.facts.map((f: string) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      {held && (
        <p className="ulises-hold">
          <span aria-hidden="true">⏳</span> On hold until <b>{when(u.friction.holdUntil)}</b>.
          Nothing has been sent. You can confirm or cancel it after that.
        </p>
      )}

      {u.friction.requiresAcknowledgement && !u.acknowledgedAt && (
        <label className={`ulises-ack ${acknowledged ? 'is-checked' : ''}`}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onAcknowledge(e.target.checked)}
          />
          <span>
            <b>I have read this and the decision is mine.</b>
            <small>
              Nobody is telling me to send it, and I know it usually cannot be reversed.
            </small>
          </span>
        </label>
      )}

      {p?.limitsSource === 'default' && !u.ownAccount && (
        <p className="ulises-default-note">
          Ulises is using default limits.{' '}
          <button className="text-button" onClick={onOpenCheck}>
            Set your own in 2 minutes →
          </button>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Projection chart under an assistant reply: the customer's next months (a year, or the whole
// instalment plan), per way of paying.
// ---------------------------------------------------------------------------------------------

// Colour follows the scenario, never its position (validated categorical slots 1-3).
const SERIES: Record<string, { color: string; dash?: string }> = {
  without: { color: '#8a948f', dash: '5 4' },
  pay_now: { color: '#2a78d6' },
  save_first: { color: '#eb6834' },
  instalments: { color: '#1baf7a' },
};
const outcomeText = (s: AnyRecord): [string, string, string] => {
  switch (s.outcome) {
    case 'negative':
      return ['critical', '✕', `Goes into the red (${s.lowestMonth})`];
    case 'below_cushion':
      return [
        'serious',
        '!',
        `Drops below your cushion${s.firstBelowCushion ? ` from ${s.firstBelowCushion}` : ''}`,
      ];
    case 'tight':
      return ['warning', '~', 'Keeps your cushion, only just'];
    default:
      return ['good', '✓', 'Keeps your cushion with room to spare'];
  }
};
const compact = (cents: number) =>
  new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    notation: Math.abs(cents) >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(cents) >= 1_000_000 ? 1 : 0,
  }).format(cents / 100);

export function ProjectionCard({ data }: { data: AnyRecord }) {
  const [hover, setHover] = useState<number | null>(null);
  const scenarios: AnyRecord[] = data.scenarios.filter((s: AnyRecord) => s.points);
  const n = scenarios[0].points.length;
  const months = n - 1;
  // One label every 2 months for a year, every quarter up to 2 years, every 6 months beyond.
  const labelEvery = months <= 12 ? 2 : months <= 24 ? 3 : 6;
  const span =
    months % 12 === 0 && months > 12
      ? `${months / 12} years`
      : `${months} month${months === 1 ? '' : 's'}`;
  // Marked only when the view goes on after the plan ends (otherwise it is the chart's edge).
  const lastInstalment =
    data.instalmentMonths && data.instalmentMonths < months ? data.instalmentMonths : null;
  const W = 640,
    H = 230,
    L = 64,
    R = 18,
    T = 14,
    B = 28;
  const all = scenarios.flatMap((s) => s.points.map((p: AnyRecord) => p.balanceCents));
  let lo = Math.min(0, data.cushionCents, ...all),
    hi = Math.max(data.cushionCents, ...all);
  const pad = (hi - lo) * 0.08 || 10000;
  hi += pad;
  if (lo < 0) lo -= pad;
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const step = (() => {
    const raw = (hi - lo) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  })();
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const path = (s: AnyRecord) =>
    s.points
      .map(
        (p: AnyRecord, i: number) =>
          `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balanceCents).toFixed(1)}`,
      )
      .join('');
  const decisions = scenarios.filter((s) => s.id !== 'without');
  const notes = data.scenarios.filter((s: AnyRecord) => s.note);

  return (
    <figure className="projection" aria-label={`Ulises projection: ${data.label}`}>
      <figcaption>
        <span className="ulises-avatar small" aria-hidden="true">
          ⛵
        </span>
        <div>
          <b>
            Your next {span} · {data.label}
          </b>
          <small>
            Price {money(data.priceCents)}
            {data.monthlyCostCents
              ? ` · running costs ${money(data.monthlyCostCents)}/month`
              : ''}{' '}
            · you keep about {money(Math.max(0, data.monthlySurplusCents))}/month
          </small>
        </div>
      </figcaption>
      <ul className="projection-legend">
        {scenarios.map((s) => (
          <li key={s.id}>
            <svg width="22" height="8" aria-hidden="true">
              <line
                x1="1"
                y1="4"
                x2="21"
                y2="4"
                stroke={SERIES[s.id].color}
                strokeWidth="2"
                strokeDasharray={SERIES[s.id].dash}
                strokeLinecap="round"
              />
            </svg>
            {s.label}
          </li>
        ))}
        <li>
          <svg width="22" height="8" aria-hidden="true">
            <line
              x1="1"
              y1="4"
              x2="21"
              y2="4"
              stroke="#c8473f"
              strokeWidth="1.5"
              strokeDasharray="2 3"
            />
          </svg>
          Your cushion
        </li>
      </ul>
      <div className="projection-plot" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Balance month by month for each way of paying"
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'zero' : 'grid'} />
              <text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">
                {compact(t)}
              </text>
            </g>
          ))}
          {scenarios[0].points.map((p: AnyRecord, i: number) =>
            i % labelEvery === 0 || n <= 7 ? (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="tick">
                {p.month}
              </text>
            ) : null,
          )}
          <line
            x1={L}
            x2={W - R}
            y1={y(data.cushionCents)}
            y2={y(data.cushionCents)}
            className="cushion-line"
          />
          {lastInstalment !== null && (
            <g>
              <line
                x1={x(lastInstalment)}
                x2={x(lastInstalment)}
                y1={T}
                y2={H - B}
                className="instalment-end"
              />
              <text x={x(lastInstalment) - 4} y={T + 10} textAnchor="end" className="tick">
                Last instalment
              </text>
            </g>
          )}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="crosshair" />
          )}
          {scenarios.map((s) => (
            <path
              key={s.id}
              d={path(s)}
              fill="none"
              stroke={SERIES[s.id].color}
              strokeWidth="2"
              strokeDasharray={SERIES[s.id].dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {scenarios.map((s) =>
            s.buyIndex !== null && s.buyIndex !== undefined ? (
              <circle
                key={`buy-${s.id}`}
                cx={x(s.buyIndex)}
                cy={y(s.points[s.buyIndex].balanceCents)}
                r="4.5"
                fill={SERIES[s.id].color}
                className="buy-dot"
              />
            ) : null,
          )}
          {hover !== null &&
            scenarios.map((s) => (
              <circle
                key={`h-${s.id}`}
                cx={x(hover)}
                cy={y(s.points[hover].balanceCents)}
                r="4"
                fill={SERIES[s.id].color}
                className="buy-dot"
              />
            ))}
        </svg>
        {hover !== null && (
          <div
            className="projection-tip"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform: `translateX(${hover > n / 2 ? 'calc(-100% - 12px)' : '12px'})`,
            }}
          >
            <b>{scenarios[0].points[hover].month}</b>
            {scenarios.map((s) => (
              <span key={s.id}>
                <i style={{ background: SERIES[s.id].color }} />
                {s.label}
                <b>{money(s.points[hover].balanceCents, 0)}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="projection-tiles">
        {decisions.map((s) => {
          const [tone, icon, text] = outcomeText(s);
          return (
            <div key={s.id} className="projection-tile">
              <span className="swatch" style={{ background: SERIES[s.id].color }} />
              <b>{s.label}</b>
              <span className={`outcome outcome-${tone}`}>
                <i aria-hidden="true">{icon}</i> {text}
              </span>
              <dl>
                <div>
                  <dt>Lowest point</dt>
                  <dd>
                    {money(s.lowestCents, 0)} · {s.lowestMonth}
                  </dd>
                </div>
                <div>
                  <dt>In {span}</dt>
                  <dd>{money(s.endCents, 0)}</dd>
                </div>
              </dl>
              {s.note && <small>{s.note}</small>}
            </div>
          );
        })}
        {notes
          .filter((s: AnyRecord) => !decisions.some((d) => d.id === s.id))
          .map((s: AnyRecord) => (
            <div key={s.id} className="projection-tile">
              <b>{s.label}</b>
              <small>{s.note}</small>
            </div>
          ))}
      </div>
      <details className="projection-table">
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {scenarios.map((s) => (
                <th scope="col" key={s.id}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenarios[0].points.map((p: AnyRecord, i: number) => (
              <tr key={i}>
                <th scope="row">{p.month}</th>
                {scenarios.map((s) => (
                  <td key={s.id}>{money(s.points[i].balanceCents, 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {data.assumptions?.length > 0 && (
        <ul className="projection-assumptions">
          {data.assumptions.map((a: string) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </figure>
  );
}
