'use client';
import React, { useEffect, useRef, useState } from 'react';
import { members } from '../server/ownership';
import { inScope, isSpend, scopeLabel, spendingSummary, toggleOwner, type CategorySpend, type HistoryBar, type OwnershipScope } from '../server/spending';
import type { Data } from './ownership-app';
import { donutPath, donutSlices } from './category-chart';

export type CategorySelection = Pick<CategorySpend, 'id' | 'name'>;
export type CategoryView = 'donut' | 'list';
const colors = ['#5eead4', '#93c5fd', '#fcd34d', '#c4b5fd', '#fda4af', '#a3e635', '#fdba74', '#67e8f9'];
const moneyFormat = (currency: string) => (amount: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100);
const percent = (amount: number, total: number) => new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(total ? amount / total : 0);

export function OwnershipScopePicker({ scope, onChange }: { scope: OwnershipScope; onChange: (scope: OwnershipScope) => void }) {
  return <nav aria-label="Expense ownership scope" className="scope-picker">
    <button type="button" aria-pressed={scope.length === 0} onClick={() => onChange([])}>All household</button>
    {members.map(owner => <button type="button" key={owner} aria-pressed={scope.includes(owner)} onClick={() => onChange(toggleOwner(scope, owner))}>{owner}</button>)}
    <p className="scope-status" role="status">{scopeLabel(scope)}{scope.length === 0 ? ' · includes unclassified expenses' : ' · saved expense ownership'}</p>
  </nav>;
}

type Props = {
  data: Data; scope: OwnershipScope; showAll: boolean; onShowAll: (value: boolean) => void;
  view: CategoryView; onView: (value: CategoryView) => void;
  detail: CategorySelection | null; onDetail: (value: CategorySelection | null) => void;
};
export function CategorySpending({ data, scope, showAll, onShowAll, view, onView, detail, onDetail }: Props) {
  const [selection, setSelection] = useState<CategorySelection | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const wasDetail = useRef(false);
  useEffect(() => {
    if (detail || wasDetail.current) title.current?.focus();
    wasDetail.current = detail !== null;
  }, [detail]);
  const categories = data.transactions.flatMap(row => row.category && row.categoryName ? [{ id: row.category, name: row.categoryName }] : []);
  const summary = spendingSummary({ transactions: data.transactions, accounts: [], categories }, data.transactions.map(row => row.metadata), data.summary, scope);
  const visible = showAll ? summary.categories : summary.categories.slice(0, 8);
  const selected = visible.find(row => selection && row.id === selection.id) ?? visible[0];
  const slices = donutSlices(visible, summary.total);
  const activeSlice = slices.find(row => row.id === selected?.id);
  const rotation = activeSlice ? 180 - activeSlice.middle : 0;
  const money = moneyFormat(data.currency);
  const omitted = summary.total - visible.reduce((sum, category) => sum + category.amount, 0);
  const detailAmount = detail ? summary.categories.find(row => row.id === detail.id)?.amount ?? 0 : 0;
  return <article className="category-panel">
    <p className="spending-range">{data.summary.from} – {data.summary.through} · UTC</p>
    <div className="spending-heading"><div><h3 ref={title} tabIndex={-1}>{detail ? detail.name : 'Spending by category'}</h3><p>{scopeLabel(scope)} · gross spending</p></div>
      <div className="scope-total"><span>{detail ? 'Category this month' : 'Spent this month'}</span><strong>{money(detail ? detailAmount : summary.total)}</strong></div>
    </div>
    {detail ? <>
      <button type="button" onClick={() => onDetail(null)}>← Back to categories</button>
      <p>{percent(detailAmount, summary.total)} of {money(summary.total)} in {scopeLabel(scope).toLowerCase()}</p>
      <CategoryDetail key={JSON.stringify([data.summary.from, detail.id, scope])} data={data} scope={scope} category={detail} amount={detailAmount} />
    </> : <>
      <div className="category-controls">
        <div role="group" aria-label="Category view"><button type="button" aria-pressed={view === 'donut'} onClick={() => onView('donut')}>Donut</button><button type="button" aria-pressed={view === 'list'} onClick={() => onView('list')}>Ranked list</button></div>
        <div role="group" aria-label="Categories shown"><button type="button" aria-pressed={!showAll} onClick={() => onShowAll(false)}>Top 8</button><button type="button" aria-pressed={showAll} onClick={() => onShowAll(true)}>All nonzero categories</button></div>
      </div>
      {summary.total === 0 ? <p role="status">No spending this month for {scopeLabel(scope).toLowerCase()}.</p> : <>
        <p className="category-coverage">{showAll ? `All ${visible.length} nonzero categories` : `Top ${visible.length} of ${summary.categories.length} categories`}{omitted > 0 && ` · ${money(omitted)} outside Top 8 (unfilled ring)`}</p>
        <div className={`category-visualization ${view}`}>
          {view === 'donut' && selected && <div className="donut-wrap">
            <svg className="category-donut" viewBox="0 0 320 320" role="group" aria-label="Spending categories. Select a slice, then open its details from the center.">
              <circle cx="160" cy="160" r="122" fill="none" stroke="#334155" strokeWidth="44" />
              <g className="donut-rotation" style={{ transform: `rotate(${rotation}deg)` }}>
                {slices.map((slice, index) => <path key={JSON.stringify(slice.id)} d={donutPath(slice.start, slice.sweep)} fill={colors[index % colors.length]} stroke="#0f172a" strokeWidth={slice.id === selected.id ? 4 : 2}
                  role="button" tabIndex={0} aria-pressed={slice.id === selected.id} aria-label={`Select ${slice.name}, ${money(slice.amount)}, ${percent(slice.amount, summary.total)} of active scope`}
                  onClick={() => setSelection(slice)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection(slice); } }} />)}
              </g>
            </svg>
            <button type="button" className="donut-center" aria-label={`Open ${selected.name} details, ${money(selected.amount)}, ${percent(selected.amount, summary.total)} of active scope`} onClick={() => onDetail(selected)}>
              <span>{selected.name}</span><strong>{money(selected.amount)}</strong><span>{percent(selected.amount, summary.total)} of scope</span><span className="detail-prompt">View details →</span>
            </button>
          </div>}
          <ol className="category-ranking" aria-label={view === 'donut' ? 'Select a category' : 'Ranked categories; open details'}>{visible.map((category, index) => <li key={JSON.stringify(category.id)}>
            <button type="button" className="category-row" aria-pressed={view === 'donut' ? category.id === selected?.id : undefined}
              aria-label={`${view === 'donut' ? 'Select' : 'Open'} ${category.name}${view === 'list' ? ' details' : ''}, ${money(category.amount)}, ${percent(category.amount, summary.total)} of active scope`}
              onClick={() => view === 'donut' ? setSelection(category) : onDetail(category)}>
              <span className="category-rank" aria-hidden="true">{index + 1}</span><span className="category-row-body"><span className="category-row-text"><span>{category.name}</span><strong>{money(category.amount)}</strong></span>
                <span className="category-row-meta"><span className="category-bar-track" aria-hidden="true"><span style={{ width: `${category.amount / summary.total * 100}%`, background: colors[index % colors.length] }} /></span><span>{percent(category.amount, summary.total)}</span></span>
              </span>
            </button>
          </li>)}</ol>
        </div>
        {view === 'donut' && selected && <p className="sr-only" role="status">Selected {selected.name}: {money(selected.amount)}, {percent(selected.amount, summary.total)} of {scopeLabel(scope)}. Activate the center to view details.</p>}
      </>}
    </>}
  </article>;
}

function CategoryDetail({ data, scope, category, amount }: { data: Data; scope: OwnershipScope; category: CategorySelection; amount: number }) {
  const [history, setHistory] = useState<HistoryBar[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const month = data.summary.from.slice(0, 7);
  const query = new URLSearchParams({ month, category: category.id ?? '' });
  scope.forEach(owner => query.append('owner', owner));
  const path = `/api/ownership/category-history?${query}`;
  useEffect(() => {
    const controller = new AbortController();
    setHistory(null); setError('');
    fetch(path, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load category history.');
      if (!controller.signal.aborted) setHistory(result.bars);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [path, retry]);
  const money = moneyFormat(data.currency);
  // The open month is authoritative from the same saved rows as its transactions.
  const bars = history?.map(bar => bar.from === data.summary.from ? { ...bar, amount } : bar);
  const max = Math.max(1, ...bars?.map(bar => bar.amount) ?? []);
  const included = data.transactions.filter(row => row.category === category.id && inScope(row.metadata.expense_owner, scope) && isSpend(row, data.summary));
  return <div className="category-detail">
    <h4>Six-month history</h4>
    <p>Gross spending · selected month and five previous months. The current month runs through today.</p>
    {!history && !error && <p role="status">Loading category history…</p>}
    {error && <div><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry history</button></div>}
    {bars && <ol className="history-bars" aria-label={`Monthly spending for ${category.name}, ${scopeLabel(scope)}`}>{bars.map(bar => {
      const label = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(bar.from + 'T00:00:00Z'));
      return <li key={bar.from}><strong>{money(bar.amount)}</strong><div className="history-bar-track" aria-hidden="true"><span style={{ '--bar-share': `${bar.amount / max * 100}%` } as React.CSSProperties} /></div><span>{label}</span></li>;
    })}</ol>}
    <h4>Included transactions</h4>
    <p>{included.length} {included.length === 1 ? 'transaction' : 'transactions'} · {data.summary.from} – {data.summary.through} · {scopeLabel(scope)}. Refunds, income and transfers are excluded.</p>
    {included.length === 0 ? <p>No spending transactions match this category and ownership selection.</p> : <ul className="included-transactions">{included.map(row => <li key={row.id}>
      <div><strong>{row.description}</strong><strong className="transaction-amount">{money(-row.amount)}</strong></div>
      <p>{row.date} · {row.account}{row.parentId ? ' · Actual split item' : ''}</p><p>Expense owner: {row.metadata.expense_owner ?? 'Unclassified'} · Payer: {row.metadata.payer ?? row.payerHint ?? 'Not set'}</p>
    </li>)}</ul>}
  </div>;
}
