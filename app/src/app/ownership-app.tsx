'use client';
import { useEffect, useState } from 'react';
import { allocate, members, type Member, type Metadata, type SplitRule } from '../server/ownership';
import type { LoginMember } from '../server/session';
type Row = { id: string; date: string; amount: number; description: string; account: string; parentId: string | null; payerHint: Member | null; metadata: Metadata };
type Data = { rules: SplitRule[]; defaultSplit: string | null; currency: string; transactions: Row[] };
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
      {shown.map(row => <TransactionEditor key={row.id} row={row} data={data} onSaved={metadata => setData(current => current && ({ ...current, transactions: current.transactions.map(t => t.id === row.id ? { ...t, metadata } : t) }))} />)}</>}
  </main>;
}
function TransactionEditor({ row, data, onSaved }: { row: Row; data: Data; onSaved: (m: Metadata) => void }) {
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
  return <article><div className="transaction-heading"><div><h2>{row.description}</h2><p>{row.date} · {row.account}{row.parentId ? ' · Actual split item' : ''}</p></div><strong>{money(row.amount)}</strong></div>
    <p className="status">{row.metadata.review_status === 'REVIEWED' ? 'Reviewed' : 'Needs review'}</p>
    <fieldset disabled={busy}><div className="fields"><label>Expense owner<select value={draft.expense_owner ?? ''} onChange={e => {
      const owner = (e.target.value || null) as Member | null;
      setDraft({ ...draft, expense_owner: owner, split_rule: owner === 'JOINT' ? data.defaultSplit : null });
    }}><option value="">Choose owner</option>{members.map(m => <option key={m}>{m}</option>)}</select></label>
    <label>Payer<select value={draft.payer ?? ''} onChange={e => setDraft({ ...draft, payer: (e.target.value || null) as Member | null })}><option value="">Choose payer</option>{members.map(m => <option key={m}>{m}</option>)}</select></label>
    {draft.expense_owner === 'JOINT' && <label>Joint split<select value={draft.split_rule ?? ''} onChange={e => setDraft({ ...draft, split_rule: e.target.value || null })}><option value="">Choose split</option>{data.rules.map(r => <option key={r.id} value={r.id}>{r.name} (Michael {r.me_percentage}% / Liz {r.wife_percentage}%)</option>)}</select></label>}</div>
    {!row.metadata.payer && row.payerHint && <p>Payer hint: {row.payerHint}, from the account name. Verify before saving.</p>}
    {split && <p>Split preview: Michael {money(split.MICHAEL)} · Liz {money(split.LIZ)}. Applies to this transaction only.</p>}
    <label>Household notes<textarea maxLength={2000} value={draft.notes ?? ''} onChange={e => setDraft({ ...draft, notes: e.target.value || null })} /></label>
    <div className="actions"><button onClick={() => save('NEEDS_REVIEW')}>Save for review</button><button className="primary" disabled={!draft.expense_owner || !draft.payer || (draft.expense_owner === 'JOINT' && !draft.split_rule)} onClick={() => save('REVIEWED')}>Confirm and mark reviewed</button></div></fieldset>
    {message && <p role="status">{message}</p>}
  </article>;
}
