'use client';
import { useEffect, useRef, useState } from 'react';
import type { Person } from '../src/types';
import { parseAmountCents } from '../src/amount';
import { caseNumber } from '../src/operator/case-number';
import { ProjectionCard, UlisesCheck, UlisesHome, UlisesPanel, ulisesLevel } from './ulises';
type AnyRecord = Record<string, any>;
const money = (cents: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const date = (value: string) =>
  new Intl.DateTimeFormat('en-IE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
const statusText: Record<string, string> = {
  requires_confirmation: 'Review the proposal below and confirm it to send the transfer.',
  completed: 'Transfer completed. You can check it in your activity.',
  processing: 'The transfer is being sent. Do not repeat it.',
  pending_verification:
    'The bank has not confirmed the result yet. Do not repeat the transfer: check its status in a moment.',
  not_executed: 'The bank has no record of this transfer. No money moved.',
  rejected: 'The bank rejected the transfer. No money moved.',
  cancelled: 'Proposal cancelled. No money moved.',
  expired: 'This proposal expired. No money moved.',
};
const outcome = (result: AnyRecord) =>
  [statusText[result.status] || result.message || result.status, result.error]
    .filter(Boolean)
    .join(' ');
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) {
    // Configuration guidance in the API response is for operators, not customers.
    const message =
      result.code === 'missing_openai_api_key'
        ? 'This feature is temporarily unavailable. Please try again later.'
        : result.error || 'The request could not be completed.';
    throw Object.assign(new Error(message), { code: result.code });
  }
  return result;
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    chat: (
      <>
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 4 8.4 8.4 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z" />
      </>
    ),
    transfer: (
      <>
        <path d="M4 7h15m-5-5 5 5-5 5M20 17H5m5 5-5-5 5-5" />
      </>
    ),
    document: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h5" />
      </>
    ),
    arrow: (
      <>
        <path d="m5 12 14 0m-6-6 6 6-6 6" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.overview}
    </svg>
  );
}
export default function Home() {
  const [people, setPeople] = useState<Person[]>([]),
    [current, setCurrent] = useState<Person | null>(null),
    [tab, setTab] = useState('overview');
  const [dashboard, setDashboard] = useState<AnyRecord | null>(null),
    [conversations, setConversations] = useState<AnyRecord[]>([]),
    [conversationId, setConversationId] = useState<string | null>(null),
    [messages, setMessages] = useState<AnyRecord[]>([]);
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [docs, setDocs] = useState<AnyRecord[]>([]),
    [document, setDocument] = useState<AnyRecord | null>(null),
    [query, setQuery] = useState(''),
    [sources, setSources] = useState<AnyRecord[] | null>(null);
  const [selectedCase, setSelectedCase] = useState<AnyRecord | null>(null),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [amount, setAmount] = useState(''),
    [concept, setConcept] = useState('');
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [projections, setProjections] = useState<AnyRecord[]>([]),
    [checkOpen, setCheckOpen] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null),
    [reply, setReply] = useState(''),
    [caseFilter, setCaseFilter] = useState<'open' | 'closed'>('open');
  const activeConversation = useRef<string | null>(null),
    busyRef = useRef(false);
  busyRef.current = busy;
  const generation = useRef(0),
    messagesEnd = useRef<HTMLDivElement>(null);
  async function refresh(g = generation.current) {
    const data = await api('dashboard');
    if (g !== generation.current) return;
    setDashboard(data);
    if (data.accounts?.length)
      setFrom((v) => (data.accounts.some((a: AnyRecord) => a.id === v) ? v : data.accounts[0].id));
  }
  async function selectPerson(id: string) {
    const g = ++generation.current;
    setCurrent(null);
    setDashboard(null);
    setConversations([]);
    activeConversation.current = null;
    setConversationId(null);
    setMessages([]);
    setProjections([]);
    setCheckOpen(false);
    setSelectedCase(null);
    setAccountId(null);
    setReply('');
    setDocument(null);
    setDocs([]);
    setSources(null);
    setError('');
    setNotice('');
    setBusy(false);
    setText('');
    setFrom('');
    setTo('');
    setAmount('');
    setConcept('');
    setTab('overview');
    try {
      const result = await api('session', { userId: id });
      if (g !== generation.current) return;
      setCurrent(result.person);
      await refresh(g);
      if (result.person.role === 'customer') {
        const cs = await api('conversations');
        if (g === generation.current) setConversations(cs);
      }
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    api('people').then(setPeople);
    api('session')
      .then((x) => selectPerson(x.person.id))
      .catch(() => selectPerson('lucia'));
  }, []);
  // Support answers arrive without the customer doing anything: keep the list (unread, resolved) and
  // the open conversation current while a customer is signed in.
  useEffect(() => {
    if (current?.role !== 'customer') return;
    const timer = setInterval(async () => {
      const g = generation.current;
      try {
        const cs = await api('conversations');
        if (g !== generation.current) return;
        setConversations(cs);
        const open = activeConversation.current,
          mine = cs.find((c: AnyRecord) => c.id === open);
        if (open && mine?.unread > 0 && !busyRef.current) {
          const c = await api(`conversations/${open}`);
          if (g === generation.current && activeConversation.current === open && !busyRef.current)
            setMessages(c.messages);
        }
      } catch {}
    }, 8000);
    return () => clearInterval(timer);
  }, [current]);
  // Operators see customer replies arrive in the inbox; the open case reloads when its customer writes.
  const openCaseId = selectedCase?.incident.id as string | undefined;
  useEffect(() => {
    if (current?.role !== 'operator') return;
    const timer = setInterval(async () => {
      const g = generation.current;
      try {
        const data = await api('dashboard');
        if (g !== generation.current) return;
        setDashboard(data);
        const mine = data.incidents?.find((c: AnyRecord) => c.id === openCaseId);
        if (mine?.customer_unread > 0 && !busyRef.current) {
          const d = await api(`incidents/${openCaseId}`);
          if (g === generation.current) setSelectedCase(d);
        }
      } catch {}
    }, 8000);
    return () => clearInterval(timer);
  }, [current, openCaseId]);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);
  async function openConversation(id: string) {
    const g = generation.current;
    activeConversation.current = id;
    setConversationId(id);
    setTab('chat');
    setMessages([]);
    setError('');
    try {
      const c = await api(`conversations/${id}`);
      if (g === generation.current && activeConversation.current === id) {
        setMessages(c.messages);
        setProjections(c.projections || []);
      }
      const cs = await api('conversations');
      if (g === generation.current) setConversations(cs);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  async function newConversation() {
    const g = generation.current;
    try {
      const c = await api('conversations', {});
      if (g !== generation.current) return;
      const cs = await api('conversations');
      if (g !== generation.current) return;
      setConversations(cs);
      activeConversation.current = c.id;
      setConversationId(c.id);
      setMessages([]);
      setTab('chat');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(value = text) {
    if (!value.trim() || busy || !current) return;
    const g = generation.current;
    setBusy(true);
    setError('');
    setText('');
    let id = conversationId;
    try {
      if (!id) {
        const c = await api('conversations', {});
        if (g !== generation.current) return;
        id = c.id;
        activeConversation.current = id;
        setConversationId(id);
      }
      setTab('chat');
      setMessages((m) => [
        ...m,
        { id: 'pending-user', role: 'user', content: value, created_at: new Date().toISOString() },
      ]);
      await api(`conversations/${id}/messages`, { content: value });
    } catch (e) {
      // The assistant's reply already explains the failure; don't repeat it in an alert.
      if (g === generation.current && (e as { code?: string }).code !== 'assistant_unavailable')
        setError((e as Error).message);
    } finally {
      if (g === generation.current) {
        try {
          if (id) {
            const c = await api(`conversations/${id}`);
            if (g === generation.current && activeConversation.current === id) {
              setMessages(c.messages);
              setProjections(c.projections || []);
            }
          }
          const cs = await api('conversations');
          if (g === generation.current) setConversations(cs);
          await refresh(g);
        } catch {}
        if (g === generation.current) setBusy(false);
      }
    }
  }
  async function openLibrary() {
    const g = generation.current;
    setTab('documents');
    setDocument(null);
    try {
      const result = await api('documents');
      if (g === generation.current) setDocs(result.documents);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  async function submitTransfer() {
    const g = generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    const amountCents = parseAmountCents(amount);
    if (!amountCents) {
      setError('Enter the amount in euros, for example 12.50 or 1,234.56.');
      setBusy(false);
      return;
    }
    try {
      const result = await api('actions', {
        name: 'transfer_money',
        intentId: crypto.randomUUID(),
        arguments: {
          fromAccountId: from,
          toAccountId: to,
          amountCents,
          concept,
        },
        conversationId,
      });
      if (g !== generation.current) return;
      setNotice(outcome(result));
      await refresh(g);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function decide(id: string, action: 'confirm' | 'cancel') {
    const g = generation.current;
    setBusy(true);
    setError('');
    try {
      const result = await api(
        `approvals/${id}/${action}`,
        action === 'confirm' ? { acknowledged: !!acks[id] } : {},
      );
      if (g !== generation.current) return;
      setNotice(outcome(result));
      await refresh(g);
      const open = activeConversation.current;
      if (open) {
        const c = await api(`conversations/${open}`);
        if (g === generation.current && activeConversation.current === open) {
          setMessages(c.messages);
          setProjections(c.projections || []);
        }
      }
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function checkStatus(intentId: string) {
    const g = generation.current;
    try {
      const result = await api('actions', {
        name: 'operation_status',
        arguments: { reference: intentId },
      });
      if (g !== generation.current) return;
      setNotice(outcome(result));
      await refresh(g);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  const accountName = (id: string) => {
    const own = dashboard?.accounts?.find((a: AnyRecord) => a.id === id);
    if (own) return `${own.label} (${own.iban.slice(-4)})`;
    const contact = dashboard?.contacts?.find((a: AnyRecord) => a.id === id);
    return contact ? `${contact.name} · ${contact.label}` : id;
  };
  async function openCase(id: string) {
    const g = generation.current;
    try {
      const d = await api(`incidents/${id}`);
      if (g === generation.current) setSelectedCase(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  // Operator actions on a case, then reload both the case and the inbox so status stays in sync.
  async function caseAction(action: 'reply' | 'close') {
    if (!selectedCase) return;
    const id = selectedCase.incident.id;
    setBusy(true);
    setError('');
    try {
      await api(`incidents/${id}/${action}`, action === 'reply' ? { content: reply } : {});
      if (action === 'reply') setReply('');
      setNotice(action === 'reply' ? 'Reply sent to the customer.' : 'Case marked as resolved.');
      await Promise.all([openCase(id), refresh()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const account = dashboard?.accounts?.find((a: AnyRecord) => a.id === accountId);
  const accountMovements: AnyRecord[] =
    dashboard?.movements?.filter((m: AnyRecord) => m.accountId === accountId) || [];
  const operator = current?.role === 'operator';
  // Who owns the open conversation: the assistant, the support team, or nobody (resolved, closed).
  const openChat = conversations.find((c) => c.id === conversationId),
    chatState: 'assistant' | 'support' | 'closed' = openChat?.state || 'assistant';
  const nav = operator
    ? [
        ['overview', 'overview', 'Cases'],
        ['documents', 'document', 'Documents'],
      ]
    : [
        ['overview', 'overview', 'Overview'],
        ['chat', 'chat', 'Assistant'],
        ['transfer', 'transfer', 'Transfers'],
        ['documents', 'document', 'Documents'],
      ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Banana Bank home">
          <span className="brand-symbol" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 32 32">
              <path d="M25 4c1 13-7 22-20 20 6 9 25 1 23-16Z" fill="currentColor" />
              <path d="m24 5 1-3 3 1" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </span>
          banana<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">{operator ? 'CUSTOMER SUPPORT' : 'PERSONAL BANKING'}</div>
        <nav>
          {nav.map(([id, icon, label]) => (
            <button
              key={id}
              className={`nav-item ${tab === id || (id === 'overview' && tab === 'account') ? 'active' : ''}`}
              onClick={() => (id === 'documents' ? openLibrary() : setTab(id))}
            >
              <Icon name={icon} />
              {label}
              {id === 'chat' && <span className="ai-badge">AI</span>}
            </button>
          ))}
        </nav>
        {!operator && (
          <>
            <div className="history-heading">
              CONVERSATIONS
              <button aria-label="New conversation" onClick={newConversation}>
                +
              </button>
            </div>
            <div className="conversation-list">
              {conversations.map((c) => {
                const unread = conversationId !== c.id && c.unread > 0;
                return (
                  <button
                    key={c.id}
                    className={[
                      conversationId === c.id ? 'selected' : '',
                      unread ? 'unread' : '',
                      c.state === 'closed' ? 'closed' : '',
                    ].join(' ')}
                    onClick={() => openConversation(c.id)}
                  >
                    <span className="conversation-dot" />
                    <span className="conversation-title">{c.title}</span>
                    {unread ? (
                      <span className="unread-badge" aria-label={`${c.unread} unread`}>
                        {c.unread}
                      </span>
                    ) : c.state === 'support' ? (
                      <span className="conversation-tag">Support</span>
                    ) : c.state === 'closed' ? (
                      <span className="conversation-tag">Resolved</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <span className="live-dot" />
          Demo environment<p>Simulated people and money</p>
          <span className="banana-mark">banana / LAB</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Banana Bank <span>/</span> {operator ? 'Customer support' : 'Personal banking'}
          </div>
          <div className="persona-control">
            <span className="demo-label">VIEW AS</span>
            <span className="avatar small" style={{ background: current?.color }}>
              {current?.initials || '·'}
            </span>
            <select
              aria-label="Switch person"
              value={current?.id || ''}
              disabled={!current}
              onChange={(e) => selectPerson(e.target.value)}
            >
              <option value="" disabled>
                Loading…
              </option>
              <optgroup label="Customers">
                {people
                  .filter((p) => p.role === 'customer')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Operators">
                {people
                  .filter((p) => p.role === 'operator')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · Operator
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
        </header>
        <main>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={() => setError('')} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="alert notice" role="status">
              {notice}
              <button onClick={() => setNotice('')} aria-label="Dismiss notice">
                ×
              </button>
            </div>
          )}
          {!current || !dashboard ? (
            <div className="loading">
              <span className="spinner" /> Getting things ready…
            </div>
          ) : (
            <>
              {tab === 'overview' && !operator && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">YOUR DAY, A LITTLE BRIGHTER</div>
                      <h1>
                        Hello, {current.name.split(' ')[0]}
                        <span className="hello-dot">.</span>
                      </h1>
                      <p>Your accounts at a glance. A helping hand when you need one.</p>
                    </div>
                    <span className="date-chip">24 September 2026</span>
                  </div>
                  <div className="account-grid">
                    {dashboard.accounts?.map((a: AnyRecord, i: number) => (
                      <button
                        className={`account-card ${i === 0 ? 'primary-account' : ''}`}
                        key={a.id}
                        aria-label={`See the transaction history of ${a.label}`}
                        onClick={() => {
                          setAccountId(a.id);
                          setTab('account');
                        }}
                      >
                        <div className="account-top">
                          <span>{a.label}</span>
                          <span className="account-icon">↗</span>
                        </div>
                        <div className="balance-label">AVAILABLE BALANCE</div>
                        <div className="balance">{money(a.balanceCents)}</div>
                        <div className="account-bottom">
                          <span>
                            {a.iban.slice(0, 9)} ···· {a.iban.slice(-4)}
                          </span>
                          <span>EUR</span>
                        </div>
                      </button>
                    ))}
                    <section className="assistant-card">
                      <div className="sparkle">✧</div>
                      <h2>
                        Your bank speaks <br />
                        your language.
                      </h2>
                      <p>Check the details, move your money, or ask for help.</p>
                      <button
                        className="text-button"
                        onClick={() => {
                          setTab('chat');
                        }}
                      >
                        Talk to the assistant <Icon name="arrow" />
                      </button>
                    </section>
                  </div>
                  <div className="dashboard-bottom">
                    <section className="panel movements">
                      <div className="section-title">
                        <h2>Recent activity</h2>
                        <span>Latest transactions</span>
                      </div>
                      {dashboard.movements?.slice(0, 7).map((m: AnyRecord) => (
                        <div className="movement" key={m.id}>
                          <span className={`movement-icon ${m.amountCents > 0 ? 'positive' : ''}`}>
                            {m.amountCents > 0 ? '↙' : '↗'}
                          </span>
                          <div>
                            <strong>{m.description}</strong>
                            <small>
                              {date(m.createdAt)} · {accountName(m.accountId)}
                            </small>
                          </div>
                          <b className={m.amountCents > 0 ? 'credit' : ''}>
                            {m.amountCents > 0 ? '+' : ''}
                            {money(m.amountCents)}
                          </b>
                        </div>
                      ))}
                    </section>
                    <div className="right-stack">
                      {dashboard.aiUsage?.label && (
                        <section className="panel ai-usage" aria-label="Assistant usage">
                          <span className="eyebrow">ASSISTANT USAGE</span>
                          <p>
                            Your profile is marked <b>{dashboard.aiUsage.label.label}</b> until{' '}
                            {date(dashboard.aiUsage.label.expires)}:{' '}
                            {dashboard.aiUsage.label.reason}. It only affects the assistant chat,
                            never your accounts, transfers or credit.
                          </p>
                          {dashboard.aiUsage.suspended && (
                            <p>Chat paused until {date(dashboard.aiUsage.suspendedUntil)}.</p>
                          )}
                          <button
                            className="text-button"
                            disabled={dashboard.aiUsage.label.appealed}
                            onClick={async () => {
                              await api('ai-usage/appeal', {});
                              setNotice('A person will review the label.');
                              await refresh();
                            }}
                          >
                            {dashboard.aiUsage.label.appealed
                              ? 'Review requested'
                              : 'Ask a person to review it'}
                          </button>
                        </section>
                      )}
                      <UlisesHome
                        profile={dashboard.ulisesProfile}
                        rules={dashboard.safetyRules || []}
                        busy={busy}
                        onOpenCheck={() => setCheckOpen(true)}
                        onRemoveRule={async (ruleId) => {
                          try {
                            const result = await api('actions', {
                              name: 'remove_safety_rule',
                              arguments: { ruleId },
                            });
                            setNotice(result.message || result.error);
                            await refresh();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      />
                      <section className="quick-action">
                        <span className="eyebrow">STRAIGHT TO IT</span>
                        <h2>
                          A transfer,
                          <br />
                          when you need one.
                        </h2>
                        <button className="primary-button" onClick={() => setTab('transfer')}>
                          Make a transfer <Icon name="arrow" />
                        </button>
                      </section>
                      <section className="support-card">
                        <Icon name="help" />
                        <h3>Here when you need us</h3>
                        <p>Pick up a conversation or ask a person for help.</p>
                        <button className="text-button" onClick={() => setTab('chat')}>
                          Open my conversations <span>↗</span>
                        </button>
                      </section>
                    </div>
                  </div>
                </>
              )}
              {tab === 'account' && !operator && account && (
                <>
                  <div className="page-heading">
                    <div>
                      <button className="text-button back-link" onClick={() => setTab('overview')}>
                        ← All accounts
                      </button>
                      <div className="eyebrow">ACCOUNT</div>
                      <h1>{account.label}</h1>
                      <p>{account.iban}</p>
                    </div>
                    <div className="account-balance">
                      <span className="balance-label">AVAILABLE BALANCE</span>
                      <strong>{money(account.balanceCents)}</strong>
                    </div>
                  </div>
                  <section className="panel movements">
                    <div className="section-title">
                      <h2>Transaction history</h2>
                      <span>
                        {accountMovements.length}{' '}
                        {accountMovements.length === 1 ? 'transaction' : 'transactions'}
                      </span>
                    </div>
                    {accountMovements.length ? (
                      accountMovements.map((m) => (
                        <div className="movement" key={m.id}>
                          <span className={`movement-icon ${m.amountCents > 0 ? 'positive' : ''}`}>
                            {m.amountCents > 0 ? '↙' : '↗'}
                          </span>
                          <div>
                            <strong>{m.description}</strong>
                            <small>{date(m.createdAt)}</small>
                          </div>
                          <b className={m.amountCents > 0 ? 'credit' : ''}>
                            {m.amountCents > 0 ? '+' : ''}
                            {money(m.amountCents)}
                          </b>
                        </div>
                      ))
                    ) : (
                      <p className="muted">No transactions on this account yet.</p>
                    )}
                    <p className="muted">
                      Shows the latest 100 transactions the bank returns across your accounts.
                    </p>
                  </section>
                </>
              )}
              {tab === 'chat' && !operator && (
                <div className="chat-layout">
                  <div className="page-heading compact">
                    <div>
                      <div className="eyebrow">ONE CONVERSATION, PLENTY OF POSSIBILITIES</div>
                      <h1>Your assistant</h1>
                      <p>Ask, plan, and get things done here.</p>
                    </div>
                    <button className="secondary-button" onClick={newConversation}>
                      + New conversation
                    </button>
                  </div>
                  <label className="conversation-picker">
                    Conversation
                    <select
                      aria-label="Conversation"
                      value={conversationId || ''}
                      onChange={(e) => openConversation(e.target.value)}
                    >
                      <option value="">New conversation</option>
                      {conversations.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <section className="chat-panel">
                    <div className="chat-header">
                      {chatState === 'assistant' ? (
                        <>
                          <span className="assistant-avatar">✧</span>
                          <div>
                            <strong>Banana Bank assistant</strong>
                            <small>
                              <span className="live-dot" /> Here to help
                            </small>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="assistant-avatar operator-avatar">☺</span>
                          <div>
                            <strong>Banana Bank support team</strong>
                            <small>
                              {chatState === 'support' ? (
                                <>
                                  <span className="live-dot" /> Case {openChat?.caseNumber} · a
                                  person answers here
                                </>
                              ) : (
                                <>Case {openChat?.caseNumber} resolved · conversation closed</>
                              )}
                            </small>
                          </div>
                        </>
                      )}
                      <span className="subtle-tag">{current.name.split(' ')[0]}</span>
                    </div>
                    {chatState === 'support' && (
                      <div className="support-banner">
                        <p>
                          <b>You are talking to our support team.</b> The assistant is paused in
                          this conversation; a person will reply here. For anything else, start a
                          new conversation.
                        </p>
                        <button className="secondary-button" onClick={newConversation}>
                          New conversation
                        </button>
                      </div>
                    )}
                    {chatState === 'assistant' && dashboard.ulisesProfile?.source === 'default' && (
                      <div className="ulises-banner">
                        <span className="ulises-avatar small" aria-hidden="true">
                          ⛵
                        </span>
                        <p>
                          <b>Ulises is on default limits.</b> Tell it your cushion and what a big
                          payment means to you, so its advice fits your life.
                        </p>
                        <button className="secondary-button" onClick={() => setCheckOpen(true)}>
                          Set my limits
                        </button>
                      </div>
                    )}
                    <div className="messages">
                      {!messages.length && (
                        <div className="chat-empty">
                          <span className="big-sparkle">✧</span>
                          <h2>What do you need today?</h2>
                          <p>Start with your accounts or a question.</p>
                          <div className="suggestions">
                            {[
                              'What are the balances of my accounts?',
                              'When is the Aurora account fee waived?',
                              'Can I afford a 12,000 € car?',
                              'I want to speak to a person',
                            ].map((s) => (
                              <button key={s} disabled={busy} onClick={() => send(s)}>
                                {s}
                                <span>↗</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {messages.map((m, i) => (
                        <div className={`message ${m.role}`} key={m.id || i}>
                          {m.role === 'assistant' && <span className="message-avatar">✧</span>}
                          {m.role === 'operator' && (
                            <span className="message-avatar operator-avatar" aria-hidden="true">
                              ☺
                            </span>
                          )}
                          <div className="bubble">
                            {m.role === 'operator' && (
                              <span className="bubble-author">Banana Bank support team</span>
                            )}
                            <div>
                              {String(m.content)
                                .split(/(\*\*[^*]+\*\*)/g)
                                .map((part, j) =>
                                  part.startsWith('**') && part.endsWith('**') ? (
                                    <strong key={j}>{part.slice(2, -2)}</strong>
                                  ) : (
                                    part
                                  ),
                                )}
                            </div>
                            <small>{date(m.created_at)}</small>
                            {m.role === 'assistant' &&
                              m.run_id &&
                              projections
                                .filter((p) => p.run_id === m.run_id)
                                .slice(-1)
                                .map((p) => <ProjectionCard key={p.id} data={p.data} />)}
                          </div>
                        </div>
                      ))}
                      {busy && chatState === 'assistant' && (
                        <div className="message assistant">
                          <span className="message-avatar">✧</span>
                          <div className="thinking">
                            <i />
                            <i />
                            <i />
                            <span>Checking…</span>
                          </div>
                        </div>
                      )}
                      <div ref={messagesEnd} />
                    </div>
                    {chatState === 'closed' ? (
                      <div className="composer closed-composer">
                        <p>
                          Case {openChat?.caseNumber} is resolved and this conversation is closed.
                        </p>
                        <button className="secondary-button" onClick={newConversation}>
                          + New conversation
                        </button>
                      </div>
                    ) : (
                      <form
                        className="composer"
                        onSubmit={(e) => {
                          e.preventDefault();
                          send();
                        }}
                      >
                        <textarea
                          aria-label="Message the assistant"
                          placeholder={
                            chatState === 'support'
                              ? 'Write to the support team…'
                              : 'What can we help with?'
                          }
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              send();
                            }
                          }}
                          rows={2}
                        />
                        <button aria-label="Send message" disabled={busy || !text.trim()}>
                          <Icon name="arrow" />
                        </button>
                      </form>
                    )}
                    <div className="chat-footnote">
                      {chatState === 'assistant'
                        ? 'AI assistant · Check important details before taking action.'
                        : 'Banana Bank support team · Replies from a person, not the AI assistant.'}
                    </div>
                  </section>
                </div>
              )}
              {tab === 'transfer' && !operator && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">FROM ONE ACCOUNT TO ANOTHER</div>
                      <h1>Transfers</h1>
                      <p>Send money to another account in this environment.</p>
                    </div>
                  </div>
                  <div className="transfer-layout">
                    <form
                      className="panel transfer-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitTransfer();
                      }}
                    >
                      <h2>Your transfer details</h2>
                      <label>
                        From account
                        <select value={from} onChange={(e) => setFrom(e.target.value)} required>
                          {dashboard.accounts?.map((a: AnyRecord) => (
                            <option key={a.id} value={a.id}>
                              {a.label} · {a.id} · {money(a.balanceCents)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Recipient
                        <select value={to} onChange={(e) => setTo(e.target.value)} required>
                          <option value="">Select an account</option>
                          {dashboard.contacts?.map((a: AnyRecord) => (
                            <option key={a.id} value={a.id}>
                              {a.name} · {a.label} · {a.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Amount in euros
                        <div className="amount-input">
                          <input
                            aria-label="Amount in euros"
                            type="number"
                            step="0.01"
                            min="0.01"
                            max="100000"
                            required
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                          />
                          <span>EUR</span>
                        </div>
                      </label>
                      <label>
                        Description
                        <input
                          value={concept}
                          onChange={(e) => setConcept(e.target.value)}
                          placeholder="What is this transfer for?"
                          maxLength={200}
                          required
                        />
                      </label>
                      <button className="primary-button" disabled={busy}>
                        {busy ? 'Processing…' : 'Send transfer'}
                        <Icon name="arrow" />
                      </button>
                    </form>
                    <aside className="transfer-note">
                      <Icon name="transfer" />
                      <h2>
                        It is all in
                        <br />
                        your activity.
                      </h2>
                      <p>
                        Check your activity to see the status of your transfers. If you have any
                        questions, the assistant can help.
                      </p>
                      <button className="text-button" onClick={() => setTab('overview')}>
                        View my accounts ↗
                      </button>
                    </aside>
                  </div>
                </>
              )}
              {!operator && dashboard.approvals?.length > 0 && (
                <section
                  className="panel approvals"
                  aria-label="Transfers awaiting your confirmation"
                >
                  <h2>Review before sending</h2>
                  <p className="muted">
                    Nothing has been sent yet. Check every detail; changing any of them needs a new
                    proposal.
                  </p>
                  {dashboard.approvals.map((a: AnyRecord) => (
                    <div key={a.id} className="evidence-row">
                      <p>
                        <strong>{money(a.payload.amountCents)}</strong>
                      </p>
                      <p>
                        From <b>{accountName(a.payload.fromAccountId)}</b> to{' '}
                        <b>{accountName(a.payload.toAccountId)}</b>
                      </p>
                      <p>Description: {a.payload.concept || '(none)'}</p>
                      <small>Valid until {date(a.expires_at)}</small>
                      {a.ulises && (
                        <UlisesPanel
                          u={a.ulises}
                          acknowledged={!!acks[a.id]}
                          onAcknowledge={(v) => setAcks((x) => ({ ...x, [a.id]: v }))}
                          onOpenCheck={() => setCheckOpen(true)}
                        />
                      )}
                      <div>
                        <button
                          className="primary-button"
                          disabled={
                            busy ||
                            (a.ulises?.friction.holdUntil &&
                              Date.parse(a.ulises.friction.holdUntil) > Date.now()) ||
                            (a.ulises?.friction.requiresAcknowledgement &&
                              !a.ulises.acknowledgedAt &&
                              !acks[a.id])
                          }
                          onClick={() => decide(a.id, 'confirm')}
                        >
                          Confirm and send
                        </button>{' '}
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => decide(a.id, 'cancel')}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}
              {!operator &&
                dashboard.transfers?.some((t: AnyRecord) =>
                  ['pending_verification', 'processing', 'unverified'].includes(t.status),
                ) && (
                  <section className="panel approvals" aria-label="Transfers being verified">
                    <h2>Waiting for the bank</h2>
                    {dashboard.transfers
                      .filter((t: AnyRecord) =>
                        ['pending_verification', 'processing', 'unverified'].includes(t.status),
                      )
                      .map((t: AnyRecord) => (
                        <div key={t.intentId} className="evidence-row">
                          <p>
                            <strong>{money(t.payload.amountCents)}</strong> to{' '}
                            {accountName(t.payload.toAccountId)} · {t.payload.concept}
                          </p>
                          <p className="muted">{statusText[t.status] || t.message}</p>
                          <button
                            className="secondary-button"
                            onClick={() => checkStatus(t.intentId)}
                          >
                            Check status
                          </button>
                        </div>
                      ))}
                  </section>
                )}
              {tab === 'overview' && operator && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">CUSTOMER SUPPORT</div>
                      <h1>Every case, a person.</h1>
                      <p>
                        Hello, {current.name.split(' ')[0]}. Here are your customer support cases.
                      </p>
                    </div>
                    <div className="case-count">
                      <strong>
                        {dashboard.incidents?.filter((c: AnyRecord) => c.status === 'open')
                          .length || 0}
                      </strong>
                      <span>open cases</span>
                    </div>
                  </div>
                  <div className="operator-grid">
                    <section className="panel case-list">
                      <div className="section-title">
                        <h2>Inbox</h2>
                      </div>
                      <div className="case-tabs" role="tablist" aria-label="Cases">
                        {(
                          [
                            ['open', 'Unresolved'],
                            ['closed', 'Resolved'],
                          ] as const
                        ).map(([status, label]) => (
                          <button
                            key={status}
                            role="tab"
                            aria-selected={caseFilter === status}
                            className={caseFilter === status ? 'selected' : ''}
                            onClick={() => setCaseFilter(status)}
                          >
                            {label}
                            {status === 'open' &&
                              dashboard.incidents?.some(
                                (c: AnyRecord) => c.status === 'open' && c.customer_unread > 0,
                              ) && <i className="notify-dot" aria-label="Customer replies" />}
                            <span>
                              {dashboard.incidents?.filter((c: AnyRecord) => c.status === status)
                                .length || 0}
                            </span>
                          </button>
                        ))}
                      </div>
                      {!dashboard.incidents?.some((c: AnyRecord) => c.status === caseFilter) && (
                        <p className="muted case-empty">
                          {caseFilter === 'open'
                            ? 'No cases waiting for support.'
                            : 'No resolved cases yet.'}
                        </p>
                      )}
                      {dashboard.incidents
                        ?.filter((c: AnyRecord) => c.status === caseFilter)
                        .map((c: AnyRecord) => (
                          <button
                            key={c.id}
                            className={`case-item ${selectedCase?.incident.id === c.id ? 'selected' : ''}`}
                            onClick={() => {
                              setReply('');
                              openCase(c.id).catch(() => {});
                            }}
                          >
                            <span
                              className="avatar"
                              style={{ background: people.find((p) => p.id === c.user_id)?.color }}
                            >
                              {people.find((p) => p.id === c.user_id)?.initials}
                            </span>
                            <div>
                              <strong>
                                {people.find((p) => p.id === c.user_id)?.name}
                                {c.customer_unread > 0 && selectedCase?.incident.id !== c.id && (
                                  <span className="customer-replied">
                                    <i aria-hidden="true" /> Customer replied
                                  </span>
                                )}
                              </strong>
                              <p>{c.summary}</p>
                              <small>
                                {caseNumber(c.id)} · {date(c.created_at)}
                              </small>
                            </div>
                            <span>↗</span>
                          </button>
                        ))}
                    </section>
                    <section className="panel case-detail">
                      {selectedCase ? (
                        <>
                          <div className="eyebrow">CASE {caseNumber(selectedCase.incident.id)}</div>
                          <h2>{selectedCase.customer.name}</h2>
                          {selectedCase.aiUsage?.label && (
                            <p className="ulises-op ulises-high">
                              {selectedCase.aiUsage.label.label} ·{' '}
                              {selectedCase.aiUsage.label.reason}
                              {selectedCase.aiUsage.label.appealed && ' · review requested'}
                            </p>
                          )}
                          <span className="status-pill">
                            {selectedCase.incident.status === 'closed'
                              ? 'Resolved'
                              : 'Awaiting support'}
                          </span>
                          <h3>Latest message</h3>
                          <blockquote>{selectedCase.lastMessage?.content}</blockquote>
                          <p className="muted">Received {date(selectedCase.incident.created_at)}</p>
                          {selectedCase.history?.length > 0 && (
                            <>
                              <h3>Conversation</h3>
                              {selectedCase.history.map((m: AnyRecord) => (
                                <p key={m.id}>
                                  <b>
                                    {m.role === 'user'
                                      ? 'Customer'
                                      : m.role === 'operator'
                                        ? 'Support'
                                        : 'Assistant'}
                                    :
                                  </b>{' '}
                                  {m.content}
                                </p>
                              ))}
                            </>
                          )}
                          {selectedCase.incident.status === 'open' ? (
                            <form
                              className="case-reply"
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (reply.trim()) caseAction('reply');
                              }}
                            >
                              <h3>Reply to the customer</h3>
                              <textarea
                                aria-label="Reply to the customer"
                                placeholder="Your reply appears in the customer's conversation."
                                value={reply}
                                maxLength={4000}
                                rows={4}
                                disabled={busy}
                                onChange={(e) => setReply(e.target.value)}
                              />
                              <div className="case-reply-actions">
                                <button
                                  type="button"
                                  className="secondary-button"
                                  disabled={busy}
                                  onClick={() => caseAction('close')}
                                >
                                  Mark as resolved
                                </button>
                                <button
                                  type="submit"
                                  className="primary-button"
                                  disabled={busy || !reply.trim()}
                                >
                                  Send reply
                                </button>
                              </div>
                            </form>
                          ) : (
                            <p className="muted">This case is resolved.</p>
                          )}
                          {selectedCase.events?.length > 0 && (
                            <>
                              <h3>Agent activity</h3>
                              {selectedCase.events.map((e: AnyRecord) => (
                                <details key={e.id}>
                                  <summary>
                                    {e.kind} · {date(e.created_at)}
                                  </summary>
                                  <pre>{JSON.stringify(e.data, null, 2)}</pre>
                                </details>
                              ))}
                            </>
                          )}
                          {selectedCase.intents?.length > 0 && (
                            <>
                              <h3>Transfer intents</h3>
                              {selectedCase.intents.map((t: AnyRecord) => (
                                <div className="evidence-row" key={t.intentId}>
                                  {money(t.payload.amountCents)} · {t.payload.fromAccountId} →{' '}
                                  {t.payload.toAccountId} · <b>{t.status}</b>
                                  <small>
                                    {t.intentId} · ref {t.reference || '—'} ·{' '}
                                    {t.bankOperation
                                      ? 'found in bank ledger'
                                      : 'not in bank ledger'}
                                  </small>
                                  {t.ulises && (
                                    <small className={`ulises-op ulises-${t.ulises.level}`}>
                                      ⛵ Ulises: {ulisesLevel[t.ulises.level]} ({t.ulises.score}
                                      /100)
                                      {t.ulises.friction.holdUntil &&
                                        ` · held until ${date(t.ulises.friction.holdUntil)}`}
                                      {t.ulises.signals.length > 0 &&
                                        ` · ${t.ulises.signals.map((x: AnyRecord) => x.label).join(', ')}`}
                                    </small>
                                  )}
                                </div>
                              ))}
                            </>
                          )}
                          {selectedCase.bank && (
                            <>
                              <h3>Bank operations</h3>
                              {selectedCase.bank.operations.map((o: AnyRecord) => (
                                <div className="evidence-row" key={o.id}>
                                  {money(o.amountCents)} · {o.status}
                                  <small>{o.reference}</small>
                                </div>
                              ))}
                            </>
                          )}
                          {selectedCase.gaps && (
                            <>
                              <h3>Gaps and discrepancies</h3>
                              {String(selectedCase.gaps)
                                .split('\n')
                                .map((gap: string) => (
                                  <p className="muted" key={gap}>
                                    {gap}
                                  </p>
                                ))}
                            </>
                          )}
                        </>
                      ) : (
                        <div className="case-empty">
                          <Icon name="chat" />
                          <h2>Open a case</h2>
                          <p>Select a case to see the available information.</p>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
              {tab === 'documents' && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">SOURCES AND POLICIES</div>
                      <h1>The details, at hand.</h1>
                      <p>Read original sources and the excerpts retrieved by the assistant.</p>
                    </div>
                    {operator && (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={async () => {
                          const g = generation.current;
                          setBusy(true);
                          try {
                            const r = await api('ingestion', {});
                            if (g !== generation.current) return;
                            setNotice(
                              `Index updated: ${r.documents} documents, ${r.chunks} excerpts.`,
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {busy ? 'Updating…' : 'Update index'}
                      </button>
                    )}
                  </div>
                  <form
                    className="search-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const g = generation.current;
                      setBusy(true);
                      try {
                        const result = await api('search', { query });
                        if (g === generation.current) setSources(result.sources);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Icon name="document" />
                    <input
                      aria-label="Search documents"
                      placeholder="Ask about a policy or search for a product…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button className="primary-button" disabled={busy || !query.trim()}>
                      Search
                    </button>
                  </form>
                  {sources && (
                    <section className="search-results">
                      <div className="section-title">
                        <h2>Retrieved excerpts</h2>
                        <button className="text-button" onClick={() => setSources(null)}>
                          Close results ×
                        </button>
                      </div>
                      {sources.map((s) => (
                        <article key={s.id}>
                          <span className="subtle-tag">Similarity {s.score.toFixed(3)}</span>
                          <h3>{s.title || 'No title in the index'}</h3>
                          <small>
                            {s.documentId} · Version {s.version ?? '—'}
                          </small>
                          <p>{s.text}</p>
                        </article>
                      ))}
                    </section>
                  )}
                  <div className="documents-layout">
                    <section className="panel document-list">
                      <div className="section-title">
                        <h2>Documents</h2>
                        <span>{docs.length} sources</span>
                      </div>
                      {docs.map((d) => (
                        <button
                          key={d.id}
                          className={document?.id === d.id ? 'selected' : ''}
                          onClick={async () => {
                            const g = generation.current;
                            try {
                              const result = await api(`documents/${d.id}`);
                              if (g === generation.current) setDocument(result);
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          <Icon name="document" />
                          <span>
                            <strong>{d.title}</strong>
                            <small>
                              v{d.version} ·{' '}
                              {d.validTo
                                ? 'Archive'
                                : d.audience === 'internal'
                                  ? 'Internal'
                                  : 'Current'}
                            </small>
                          </span>
                          <span>↗</span>
                        </button>
                      ))}
                    </section>
                    <section className="panel document-reader">
                      {document ? (
                        <>
                          <div className="eyebrow">ORIGINAL SOURCE · V{document.version}</div>
                          <h2>{document.title}</h2>
                          <p className="muted">
                            Effective: {document.validFrom}
                            {document.validTo ? ` — ${document.validTo}` : ''}
                          </p>
                          <pre>{document.text}</pre>
                        </>
                      ) : (
                        <div className="case-empty">
                          <Icon name="document" />
                          <h2>Open a source</h2>
                          <p>Check policies, exceptions, and dates in the original document.</p>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
            </>
          )}
          {checkOpen && dashboard?.ulisesProfile && current?.role === 'customer' && (
            <UlisesCheck
              userId={current.id}
              profile={dashboard.ulisesProfile}
              serverDraft={dashboard.ulisesCheckDraft ?? null}
              api={api}
              onClose={() => {
                setCheckOpen(false);
                refresh().catch(() => {});
              }}
              onSaved={() => refresh()}
            />
          )}
        </main>
        <footer>
          banana<span>A simulated environment for building better experiences.</span>
          <span>banana · 2026</span>
        </footer>
      </div>
    </div>
  );
}
