'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { allocate, members, type Member, type Metadata, type SplitRule } from '../server/ownership';
import { monthlySummary, type MonthlySummary } from '../server/monthly-summary';
import { billDueStatus, type BillCard, type BillMetadata } from '../server/bills';
import type { LoginMember } from '../server/session';
type Row = { transfer_id?: string | null; id: string; date: string; amount: number; description: string; categoryName: string | null; account: string; parentId: string | null; payerHint: Member | null; metadata: Metadata };
type Data = { bills: BillCard[]; summary: MonthlySummary; rules: SplitRule[]; defaultSplit: string | null; currency: string; transactions: Row[] };
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
export default function OwnershipApp({ member }: { member: LoginMember | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Member | 'ALL'>('ALL');
  const [queue, setQueue] = useState(true);
  async function load() {
    setLoading(true); setError('');
    try { setData(await api('/api/ownership')); } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (member) void load(); }, [member]);
  if (!member) return <main className="login"><h1>Nest Ledger</h1><p>Sign in to review household transactions.</p>
    <form onSubmit={async e => {
      e.preventDefault(); setError(''); setLoading(true);
      const fields = new FormData(e.currentTarget);
      try { await api('/api/auth/login', 'POST', { member: fields.get('member'), password: fields.get('password') }); window.location.reload(); }
      catch (e) { setError((e as Error).message); setLoading(false); }
    }}><label>Household member<select name="member"><option>MICHAEL</option><option>LIZ</option></select></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={1024} /></label>
      <button disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
    </form>{error && <p role="alert">{error}</p>}</main>;
  const shown = data?.transactions.filter(t => (filter === 'ALL' || t.metadata.expense_owner === filter) && (!queue || t.metadata.review_status === 'NEEDS_REVIEW')) ?? [];
  return <main><header><div><h1>Transaction ownership</h1><p>Signed in as {member}</p></div><button onClick={async () => {
    try { await api('/api/auth/logout', 'POST'); window.location.reload(); } catch (e) { setError((e as Error).message); }
  }}>Sign out</button></header>
    <p>Current UTC month through today. Confirm who owns each expense and who paid it. Account hints need your confirmation.</p>
    <nav aria-label="Expense owner filter">{(['ALL', ...members] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</nav>
    <div className="toolbar"><label className="check"><input type="checkbox" checked={queue} onChange={e => setQueue(e.target.checked)} />Needs review only</label><button disabled={loading} onClick={load}>{loading ? 'Loading…' : 'Refresh'}</button></div>
    <p>Filters use confirmed expense ownership. Untagged transactions appear under ALL.</p>
    {error && <p role="alert">{error}</p>}
    {data && <><p role="status">{shown.length} transactions shown · {data.transactions.filter(t => t.metadata.review_status === 'NEEDS_REVIEW').length} need review this month</p>
      {shown.length === 0 && <p>No transactions match this view.</p>}
      {shown.map(row => <TransactionEditor key={row.id} row={row} data={data} onSaved={metadata => setData(current => current && ({ ...current, transactions: current.transactions.map(t => t.id === row.id ? { ...t, metadata } : t) }))} />)}
      <MonthlyOverview data={data} />
      <section className="monthly-summary" aria-labelledby="bills-title"><h2 id="bills-title">Upcoming bills</h2>
        <p>All household schedules from Actual. Responsibility and autopay are household reminders.</p>
        {data.bills.length === 0 && <p>No schedules configured in Actual yet.</p>}
        {data.bills.map(row => <BillEditor key={row.actual_schedule_id} row={row} currency={data.currency} onSaved={metadata => setData(current => current && ({ ...current, bills: current.bills.map(b => b.actual_schedule_id === row.actual_schedule_id ? { ...b, ...metadata } : b) }))} />)}
      </section></>}
  </main>;
}
function MonthlyOverview({ data }: { data: Data }) {
  // Recalculate owners from saved rows so successful tagging updates the cards immediately.
  const owners = monthlySummary({ transactions: data.transactions, accounts: [], categories: [] }, data.transactions.map(row => row.metadata), data.summary.through).owners;
  const money = (amount: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: data.currency }).format(amount / 100);
  return <section className="monthly-summary" aria-labelledby="monthly-summary-title">
    <h2 id="monthly-summary-title">Monthly household spending</h2>
    <p>{data.summary.from} – {data.summary.through} · UTC <span className="review-status">All household transactions</span></p>
    <p>Spending excludes income, refunds and transfers. Saved owner tags count even when awaiting review. Review filters do not change these totals.</p>
    <div className="summary-cards">{([...members, 'UNCLASSIFIED'] as const).map(owner => <article className="review-card" key={owner}>
      <h3>{owner === 'UNCLASSIFIED' ? 'Unclassified' : owner}</h3><strong className="transaction-amount">{money(owners[owner])}</strong>
    </article>)}</div>
    <article className="review-card"><h3>Top categories <span className="review-status">Overall · up to 8</span></h3>
      {data.summary.topCategories.length === 0 ? <p>No spending this month.</p> : <ol className="summary-categories">{data.summary.topCategories.map(category => <li key={category.id ?? 'uncategorized'}><span>{category.name}</span><strong className="transaction-amount">{money(category.amount)}</strong></li>)}</ol>}
    </article>
  </section>;
}
function TransactionEditor({ row, data, onSaved }: { row: Row; data: Data; onSaved: (m: Metadata) => void }) {
  const advancedId = useId();
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState<Metadata>({ ...row.metadata, payer: row.metadata.payer ?? row.payerHint });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setDraft({ ...row.metadata, payer: row.metadata.payer ?? row.payerHint }); }, [row.metadata, row.payerHint]);
  const money = (amount: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: data.currency }).format(amount / 100);
  const rule = data.rules.find(r => r.id === draft.split_rule);
  const split = draft.expense_owner === 'JOINT' && rule ? allocate(row.amount, rule) : null;
  async function save(review_status: Metadata['review_status']) {
    setBusy(true); setMessage('');
    try { const result = await api('/api/ownership', 'PUT', { ...draft, review_status }); onSaved(result.metadata); setMessage(review_status === 'REVIEWED' ? 'Review confirmed.' : 'Saved for review.'); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <article className="review-card"><div className="transaction-heading">
    <h2>{row.description}</h2><div className="transaction-header-controls"><strong className="transaction-amount">{money(row.amount)}</strong>
      <button className="advanced-toggle" type="button" disabled={busy} aria-expanded={advanced} aria-controls={advancedId} onClick={() => setAdvanced(!advanced)}>Advanced</button>
    </div></div>
    <div className="transaction-meta"><span>{[row.date, row.account, row.categoryName, row.parentId ? 'Actual split item' : null].filter(Boolean).join(' · ')}</span>
      <span className={`review-status${row.metadata.review_status === 'REVIEWED' ? ' reviewed' : ''}`}>{row.metadata.review_status === 'REVIEWED' ? 'Reviewed' : 'Needs review'}</span>
    </div>
    <fieldset disabled={busy}><div className="ownership-controls">
      <div className="owner-control" role="group" aria-label="Expense owner"><span>Expense owner</span><div className="owner-buttons">{members.map(owner => <button type="button" key={owner} aria-pressed={draft.expense_owner === owner} onClick={() => {
        setDraft({ ...draft, expense_owner: owner, split_rule: owner === 'JOINT' ? (draft.expense_owner === 'JOINT' ? draft.split_rule : data.defaultSplit) : null });
      }}>{owner}</button>)}</div></div>
      <span className="payer-summary">Payer: <strong>{draft.payer ?? 'Not set'}</strong></span>
      <div className="actions"><button onClick={() => save('NEEDS_REVIEW')}>Save for review</button><button className="primary" disabled={!draft.expense_owner || !draft.payer || (draft.expense_owner === 'JOINT' && !draft.split_rule)} onClick={() => save('REVIEWED')}>Confirm and mark reviewed</button></div></div>
    {!draft.payer && <p>Choose a payer in Advanced before confirming review.</p>}
    <div className="advanced-fields" id={advancedId} hidden={!advanced}>
      {!row.metadata.payer && row.payerHint && <p>Payer hint: {row.payerHint}, from the account name. Verify before saving.</p>}
      <div className="fields"><label>Payer override<select value={draft.payer ?? ''} onChange={e => setDraft({ ...draft, payer: (e.target.value || null) as Member | null })}><option value="">Choose payer</option>{members.map(m => <option key={m}>{m}</option>)}</select></label>
      {draft.expense_owner === 'JOINT' && <label>Joint split<select value={draft.split_rule ?? ''} onChange={e => setDraft({ ...draft, split_rule: e.target.value || null })}><option value="">Choose split</option>{data.rules.map(r => <option key={r.id} value={r.id}>{r.name} (Michael {r.me_percentage}% / Liz {r.wife_percentage}%)</option>)}</select></label>}</div>
      {split && <p>Split preview: Michael {money(split.MICHAEL)} · Liz {money(split.LIZ)}. Applies to this transaction only.</p>}
      <label>Household notes<textarea maxLength={2000} value={draft.notes ?? ''} onChange={e => setDraft({ ...draft, notes: e.target.value || null })} /></label>
    </div></fieldset>
    {message && <p role="status">{message}</p>}
  </article>;
}

function BillEditor({ row, currency, onSaved }: { row: BillCard; currency: string; onSaved: (m: BillMetadata) => void }) {
  const responsibilityButton = useRef<HTMLButtonElement>(null);
  const due = billDueStatus(row.next_date);
  const money = (amount: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100);
  const [draft, setDraft] = useState<BillMetadata>(row);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setDraft(row); }, [row]);
  async function save() {
    setBusy(true); setMessage('');
    try {
      const result = await api('/api/ownership/bills', 'PUT', { actual_schedule_id: row.actual_schedule_id, responsible_person: draft.responsible_person, autopay: draft.autopay });
      onSaved(result.metadata); setMessage('Bill saved.');
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <article className="review-card bill-card" aria-label={row.name}>
    <div className="transaction-heading"><h3>{row.name}</h3>
      {row.amount !== null && <strong className="transaction-amount">{money(Math.abs(row.amount))}</strong>}
    </div>
    <div className="transaction-meta"><span>{row.next_date ? `Next date: ${row.next_date}` : 'No next date available'}</span>
      <span>{row.amount === null ? 'No fixed amount available' : 'Schedule amount'}</span>
      {due && <span className={`review-status ${due.kind}`}>{due.label}</span>}
      <span className={`review-status${draft.autopay ? ' reviewed' : ''}`}>{draft.autopay ? '✓ Autopay' : 'Autopay off'}</span>
    </div>
    <div className="bill-responsibility"><span>Who pays · Responsible person</span>
      {draft.responsible_person ? <strong className="bill-owner-chip">{draft.responsible_person}</strong> : <button className="bill-unassigned" type="button" disabled={busy} onClick={() => responsibilityButton.current?.focus()}>Unassigned <span aria-hidden="true">→</span><span className="sr-only">: choose a responsible person</span></button>}
    </div>
    <p className="bill-source">{row.payingAccount ? `Paying account: ${row.payingAccount}` : 'Source: Actual schedule · Paying account unavailable'}</p>
    <fieldset disabled={busy}><div className="ownership-controls">
      <div className="owner-control" role="group" aria-label="Responsible person"><span>Responsible person</span><div className="owner-buttons">{members.map(person => <button type="button" key={person} ref={person === members[0] ? responsibilityButton : undefined} aria-pressed={draft.responsible_person === person} onClick={() => setDraft({ ...draft, responsible_person: person })}>{person}</button>)}</div></div>
      <label className="check"><input type="checkbox" checked={draft.autopay} onChange={e => setDraft({ ...draft, autopay: e.target.checked })} />Autopay</label>
      <div className="actions"><button type="button" onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
    </div></fieldset>
    {message && <p role="status">{message}</p>}
  </article>;
}
