'use client';
import React, { useEffect, useId, useState } from 'react';
import { allocate, members, type Member, type Metadata, type SplitRule } from '../server/ownership';
import type { MonthlySummary } from '../server/monthly-summary';
import { inScope, type OwnershipScope } from '../server/spending';
import { CategorySpending, OwnershipScopePicker, type CategorySelection, type CategoryView } from './category-spending';
import { billDueStatus, type BillCard, type BillMetadata } from '../server/bills';
import type { LoginMember } from '../server/session';
type Row = { category: string | null; transfer_id?: string | null; id: string; date: string; amount: number; description: string; categoryName: string | null; account: string; parentId: string | null; payerHint: Member | null; metadata: Metadata };
export type Data = { bills: BillCard[]; summary: MonthlySummary; rules: SplitRule[]; defaultSplit: string | null; currency: string; transactions: Row[] };
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
  const [scope, setScope] = useState<OwnershipScope>([]);
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState<CategoryView>('donut');
  const [detail, setDetail] = useState<CategorySelection | null>(null);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!member) return;
    let active = true;
    setLoading(true); setError(''); setData(null);
    api(`/api/ownership?month=${month}`).then(result => {
      if (active) setData(result);
    }).catch(e => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [member, month, refresh]);
  function changeMonth(value: string) {
    setData(null); setMonth(value);
  }
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
  const shown = data?.transactions.filter(t => inScope(t.metadata.expense_owner, scope)) ?? [];
  return <main><header><div><h1>Transaction ownership</h1><p>Signed in as {member}</p></div><div className="header-actions"><button disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? 'Loading…' : 'Refresh'}</button><button onClick={async () => {
    try { await api('/api/auth/logout', 'POST'); window.location.reload(); } catch (e) { setError((e as Error).message); }
  }}>Sign out</button></div></header>
    <OwnershipScopePicker scope={scope} onChange={setScope} />
    {error && <p role="alert">{error}</p>}
    <section className="monthly-summary" aria-labelledby="monthly-summary-title">
      <h2 id="monthly-summary-title">Monthly household spending</h2>
      <MonthPicker month={month} currentMonth={currentMonth} onChange={changeMonth} />
      {loading && <p role="status">Loading selected month…</p>}
      {data && <CategorySpending data={data} scope={scope} showAll={showAll} onShowAll={setShowAll} view={view} onView={setView} detail={detail} onDetail={setDetail} />}
    </section>
    {data && !detail && <><h2 className="transactions-title">Transactions</h2><p role="status">{shown.length} transactions shown</p>
      {shown.length === 0 && <p>No transactions match this view.</p>}
      {shown.map(row => <TransactionEditor key={row.id} row={row} data={data} onSaved={metadata => setData(current => current && ({ ...current, transactions: current.transactions.map(t => t.id === row.id ? { ...t, metadata } : t) }))} />)}
      <section className="monthly-summary" aria-labelledby="bills-title"><h2 id="bills-title">Upcoming bills</h2>
        <p>All household schedules from Actual. Responsibility and autopay are household reminders.</p>
        {data.bills.length === 0 && <p>No schedules configured in Actual yet.</p>}
        {data.bills.map(row => <BillEditor key={row.actual_schedule_id} row={row} currency={data.currency} onSaved={metadata => setData(current => current && ({ ...current, bills: current.bills.map(b => b.actual_schedule_id === row.actual_schedule_id ? { ...b, ...metadata } : b) }))} />)}
      </section></>}
  </main>;
}
function MonthPicker({ month, currentMonth, onChange }: { month: string; currentMonth: string; onChange: (month: string) => void }) {
  const date = new Date(month + '-01T00:00:00Z');
  function move(offset: number) {
    const next = new Date(date);
    next.setUTCMonth(next.getUTCMonth() + offset);
    onChange(next.toISOString().slice(0, 7));
  }
  return <nav aria-label="Summary month">
    <button type="button" aria-label="Previous month" disabled={month === '0001-01'} onClick={() => move(-1)}>←</button>
    <span aria-live="polite">{new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)}</span>
    <button type="button" aria-label="Next month" disabled={month >= currentMonth} onClick={() => move(1)}>→</button>
    {month !== currentMonth && <button type="button" onClick={() => onChange(currentMonth)}>Back to current month</button>}
  </nav>;
}
function TransactionEditor({ row, data, onSaved }: { row: Row; data: Data; onSaved: (m: Metadata) => void }) {
  const advancedId = useId();
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState<Metadata>({ ...row.metadata, payer: row.metadata.payer ?? row.payerHint });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  useEffect(() => { setDraft({ ...row.metadata, payer: row.metadata.payer ?? row.payerHint }); }, [row.metadata, row.payerHint]);
  const money = (amount: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: data.currency }).format(amount / 100);
  const rule = data.rules.find(r => r.id === draft.split_rule);
  const split = draft.expense_owner === 'JOINT' && rule ? allocate(row.amount, rule) : null;
  // Every change saves directly; there is no review or confirmation gate.
  async function save(change: Partial<Metadata>) {
    setBusy(true); setMessage(null);
    try {
      const result = await api(`/api/ownership?month=${data.summary.from.slice(0, 7)}`, 'PUT', { ...draft, ...change, review_status: 'REVIEWED' });
      onSaved(result.metadata);
      setDraft({ ...result.metadata, payer: result.metadata.payer ?? row.payerHint });
      setMessage({ text: 'Saved.', failed: false });
      setTimeout(() => setMessage(null), 2500);
    } catch (e) {
      setMessage({ text: (e as Error).message, failed: true });
    } finally { setBusy(false); }
  }
  return <article className="review-card"><div className="transaction-heading">
    <h2>{row.description}</h2><div className="transaction-header-controls"><strong className="transaction-amount">{money(row.amount)}</strong>
      <button className="advanced-toggle" type="button" disabled={busy} aria-expanded={advanced} aria-controls={advancedId} onClick={() => setAdvanced(!advanced)}>Advanced</button>
    </div></div>
    <div className="transaction-meta"><span>{[row.date, row.account, row.categoryName, row.parentId ? 'Actual split item' : null].filter(Boolean).join(' · ')}</span>
    </div>
    <fieldset disabled={busy}><div className="ownership-controls">
      <div className="owner-control" role="group" aria-label="Expense owner"><span>Expense owner</span><div className="owner-buttons">{members.map(owner => <button type="button" key={owner} aria-pressed={draft.expense_owner === owner} onClick={() => {
        if (draft.expense_owner === owner) return;
        save({ expense_owner: owner, split_rule: owner === 'JOINT' ? (draft.expense_owner === 'JOINT' ? draft.split_rule : data.defaultSplit) : null });
      }}>{owner}</button>)}</div></div>
      <span className="payer-summary">Payer: <strong>{draft.payer ?? 'Not set'}</strong></span>
    </div>
    {!draft.payer && <p>Choose a payer in Advanced so the household knows who paid this.</p>}
    <div className="advanced-fields" id={advancedId} hidden={!advanced}>
      {!row.metadata.payer && row.payerHint && <p>Payer hint: {row.payerHint}, from the account name.</p>}
      <div className="fields"><label>Payer<select value={draft.payer ?? ''} onChange={e => setDraft({ ...draft, payer: (e.target.value || null) as Member | null })}><option value="">Choose payer</option>{members.map(m => <option key={m}>{m}</option>)}</select></label>
      {draft.expense_owner === 'JOINT' && <label>Joint split<select value={draft.split_rule ?? ''} onChange={e => setDraft({ ...draft, split_rule: e.target.value || null })}><option value="">Choose split</option>{data.rules.map(r => <option key={r.id} value={r.id}>{r.name} (Michael {r.me_percentage}% / Liz {r.wife_percentage}%)</option>)}</select></label>}</div>
      {split && <p>Split preview: Michael {money(split.MICHAEL)} · Liz {money(split.LIZ)}. Applies to this transaction only.</p>}
      <label>Household notes<textarea maxLength={2000} value={draft.notes ?? ''} onChange={e => setDraft({ ...draft, notes: e.target.value || null })} /></label>
      <div className="actions"><button type="button" onClick={() => save({})}>{busy ? 'Saving…' : 'Save'}</button></div>
    </div></fieldset>
    {message && <p className={message.failed ? undefined : 'toast'} role={message.failed ? 'alert' : 'status'}>{message.text}</p>}
  </article>;
}

function BillEditor({ row, currency, onSaved }: { row: BillCard; currency: string; onSaved: (m: BillMetadata) => void }) {
  const [editing, setEditing] = useState(row.responsible_person === null);
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
      onSaved(result.metadata); setEditing(false); setMessage('Bill saved.'); setTimeout(() => setMessage(''), 2500);
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
      {!editing && <span className={`review-status${row.autopay ? ' reviewed' : ''}`}>{row.autopay ? '✓ Autopay' : 'Autopay off'}</span>}
    </div>
    {!editing && <div className="bill-responsibility"><span>Who pays · Responsible person</span>
      <strong className={`bill-owner-chip${row.responsible_person === null ? ' bill-unassigned' : ''}`}>{row.responsible_person ?? 'Unassigned'}</strong>
    </div>}
    <div className="bill-footer"><p className="bill-source">{row.payingAccount ? `Paying account: ${row.payingAccount}` : 'Source: Actual schedule · Paying account unavailable'}</p>
    {!editing && <button type="button" className="bill-edit-inline" disabled={busy} onClick={() => { setDraft(row); setMessage(''); setEditing(true); }}>Edit</button>}
    </div>
    {editing && <fieldset disabled={busy}><div className="ownership-controls">
      <div className="owner-control" role="group" aria-label="Responsible person"><span>Responsible person</span><div className="owner-buttons">{members.map(person => <button type="button" key={person} aria-pressed={draft.responsible_person === person} onClick={() => setDraft({ ...draft, responsible_person: person })}>{person}</button>)}</div></div>
      <label className="check"><input type="checkbox" checked={draft.autopay} onChange={e => setDraft({ ...draft, autopay: e.target.checked })} />Autopay</label>
      <div className="actions"><button type="button" onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
    </div></fieldset>}
    {message && <p className="toast" role="status">{message}</p>}
  </article>;
}
