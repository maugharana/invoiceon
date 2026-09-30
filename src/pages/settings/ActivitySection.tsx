import { Download, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toCsv } from '../../../shared/csv';
import { useToast } from '../../components/Toast';
import { Button, EmptyState, ErrorNote, Input, SearchInput, Select, TableSkeleton } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { formatDateTime, plural } from '../../lib/format';

const KINDS: [string, string][] = [
  ['', 'Everything'],
  ['invoice', 'Invoices'],
  ['credit-note', 'Credit notes'],
  ['payment', 'Payments'],
  ['proforma', 'Proformas'],
  ['stock', 'Stock changes'],
  ['variant', 'Prices and variants'],
  ['design', 'Designs'],
  ['material', 'Raw materials'],
  ['customer', 'Customers'],
  ['expense', 'Expenses'],
  ['purchase-bill', 'Purchase bills'],
  ['supplier', 'Suppliers'],
  ['supplier-payment', 'Supplier payments'],
  ['job-order', 'Weaver orders'],
  ['weaver', 'Weavers'],
  ['weaver-payment', 'Weaver payments'],
  ['settings', 'Settings'],
  ['backup', 'Backups and restores'],
];

/** The activity log: what was done, when and by whom. It cannot be edited, and the Data Management checks say if anyone tried. */
export function ActivitySection() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const limit = 500;
  const log = useQuery(() => api.auditList({ search: debounced, entity: entity || undefined, from: from || undefined, to: to || undefined, limit }), [debounced, entity, from, to]);
  const list = log.data;

  async function exportCsv() {
    try {
      const rows = await api.auditList({ search: debounced, entity: entity || undefined, from: from || undefined, to: to || undefined, limit: 5000 });
      const csv = toCsv([['When', 'Who', 'What', 'Kind', 'Details'], ...rows.map((e) => [e.at.replace('T', ' ').slice(0, 19), e.actor, e.summary, e.entity, e.detail ? JSON.stringify(e.detail) : ''])]);
      const name = 'Activity log.csv';
      if (window.invoiceon) {
        if ((await api.exportSave(name, csv)).saved) toast.success('Saved');
      } else {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-ink-muted">Every change made in InvoiceOn is written here as it happens: what, when and by whom. Entries cannot be edited or removed.</p>
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search the log" />
        <div className="w-48">
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Kind of activity">
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="num w-40" aria-label="From date" />
        <span className="text-ink-muted">to</span>
        <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="num w-40" aria-label="To date" />
        <Button className="ml-auto" icon={<Download className="h-4 w-4" />} onClick={() => void exportCsv()}>
          Export CSV
        </Button>
      </div>
      {log.error && <ErrorNote>{log.error}</ErrorNote>}
      <div className="overflow-hidden rounded-lg border border-line">
        {log.loading ? (
          <TableSkeleton columns={3} />
        ) : list?.length === 0 ? (
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title="Nothing logged" body="Nothing matches these filters yet. Changes you make appear here straight away." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-xs text-ink-muted">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-4 py-2 font-medium">What</th>
              </tr>
            </thead>
            <tbody>
              {list?.map((e) => (
                <tr key={e.id} className="border-b border-line/70 align-top last:border-0">
                  <td className="num whitespace-nowrap px-4 py-2.5 text-ink-muted">{formatDateTime(e.at)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{e.actor}</td>
                  <td className="px-4 py-2.5">{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list && list.length > 0 && <p className="text-xs text-ink-muted">Showing the latest {plural(list.length, 'entry', 'entries')}{list.length >= limit ? '. Narrow the dates to see older ones, or export the log.' : '.'}</p>}
    </div>
  );
}
