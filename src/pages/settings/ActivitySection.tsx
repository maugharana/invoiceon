import { useEffect, useState } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import type { AuditEntry } from '../../../shared/types';
import { Card, EmptyState, Input, SearchInput, Select, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { navigate, paths } from '../../lib/router';

const KINDS: [string, string][] = [
  ['', 'Everything'],
  ['invoice', 'Invoices'],
  ['proforma', 'Proformas'],
  ['payment', 'Payments'],
  ['customer', 'Customers'],
  ['design', 'Designs and stock'],
  ['expense', 'Expenses'],
  ['purchase', 'Purchases'],
  ['material', 'Raw materials'],
  ['weaver_order', 'Weaver orders'],
  ['settings', 'Settings'],
  ['data', 'Data and backups'],
];

/** Where each kind of entry leads when clicked. Entries about things that are gone, or have no page, aren't links. */
function destination(e: AuditEntry): string | null {
  if (!e.entityId) return null;
  switch (e.entityType) {
    case 'invoice':
      return paths.invoice(e.entityId);
    case 'proforma':
      return paths.proforma(e.entityId);
    case 'customer':
      return paths.customer(e.entityId);
    case 'design':
      return paths.design(e.entityId);
    case 'weaver_order':
      return paths.weaverOrder(e.entityId);
    default:
      return null;
  }
}

/** A plain list of what was done, newest first, for looking back at "when did that change?". */
export function ActivitySection() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  const log = useQuery(() => api.auditList({ search: debounced, entityType: kind || undefined, from: from || undefined, to: to || undefined, limit: 300 }), [debounced, kind, from, to]);
  const rows = log.data ?? [];

  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-canvas px-3 py-2 text-ink-muted">Every change you make is noted here with the time it happened: invoices issued, payments reversed, prices changed, settings saved. It is a short description, not a copy of the record, and it can't be edited.</p>
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search the activity" />
        <div className="w-48">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of activity">
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <Input type="date" value={from} max={to || todayIso()} onChange={(e) => setFrom(e.target.value)} className="num w-40" aria-label="From" />
        <span className="text-ink-muted">to</span>
        <Input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} className="num w-40" aria-label="To" />
      </div>
      {log.loading && rows.length === 0 ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<span className="text-2xl">🕘</span>} title="Nothing here yet" body={search || kind || from || to ? 'No activity matches those filters.' : 'As you work, what you do is listed here.'} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line/70">
            {rows.map((e) => {
              const to = destination(e);
              return (
                <li key={e.id} className="grid grid-cols-[9.5rem_1fr] gap-4 px-5 py-2.5">
                  <span className="num text-xs text-ink-muted">
                    {formatDate(new Date(e.at).toISOString().slice(0, 10))}
                    <br />
                    {new Date(e.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className="min-w-0">
                    {to ? (
                      <button type="button" onClick={() => navigate(to)} className="text-left transition-colors hover:text-brand">
                        {e.label}
                      </button>
                    ) : (
                      e.label
                    )}
                    {(e.summary || e.actor) && <span className="block truncate text-xs text-ink-muted">{[e.summary, e.actor && `by ${e.actor}`].filter(Boolean).join(' · ')}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {rows.length >= 300 && <p className="text-xs text-ink-muted">Showing the latest 300. Narrow it down with the filters to see older entries.</p>}
    </div>
  );
}
