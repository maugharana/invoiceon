import { ChevronRight, Table2 } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { dayBookCsv, marginCsv, movementCsv, moversCsv, profitLossCsv, receivablesCsv } from '../../../shared/csv';
import { formatDate } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { resolvePeriod, type PeriodSpec } from '../../../shared/periods';
import { PAYMENT_METHOD_LABEL, type DayBookMode, type MarginBy, type MoverClass } from '../../../shared/types';
import { Card, EmptyState, ErrorNote, Figure, Money, Pill, Segmented, Spinner, type PillTone } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { ExportButton, Section, useReportExport } from './parts';

const Toolbar = ({ children }: { children: ReactNode }) => <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">{children}</div>;
const Empty = ({ title, body }: { title: string; body: string }) => (
  <Card>
    <EmptyState icon={<Table2 className="h-6 w-6" />} title={title} body={body} />
  </Card>
);
const dash = <span className="text-ink-muted/50">—</span>;
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}%`);

/** How much more or less than before, as a share. Nothing when there was nothing to compare with. */
function Change({ now, before }: { now: number; before: number }) {
  if (before === 0) return dash;
  const p = Math.round(((now - before) / Math.abs(before)) * 100);
  if (p === 0) return <span className="text-ink-muted">0%</span>;
  return <span className={p > 0 ? 'text-status-paid-fg' : 'text-status-overdue-fg'}>{p > 0 ? '↑' : '↓'} {Math.abs(p)}%</span>;
}

// ── Profit and loss ─────────────────────────────────────────────────────────
export function ProfitTab({ period }: { period: PeriodSpec }) {
  const exportCsv = useReportExport();
  const range = resolvePeriod(period);
  const q = useQuery(() => api.reportProfitLoss(range), [range.from, range.to]);
  const r = q.data;
  if (q.error && !r) return <ErrorNote>{q.error}</ErrorNote>;
  if (!r) return <Spinner />;
  const last = r.lastYear;
  const empty = r.invoiceCount === 0 && r.expensesPaise === 0;

  const Row = ({ label, now, before, strong, indent }: { label: string; now: number; before?: number; strong?: boolean; indent?: boolean }) => (
    <tr className={`border-b border-line/70 last:border-0 ${strong ? 'bg-canvas' : ''}`}>
      <td className={`td ${indent ? 'pl-10 text-ink-muted' : ''}`}>{label}</td>
      <td className="td text-right">
        <Money paise={now} />
      </td>
      {last && (
        <>
          <td className="td text-right text-ink-muted">{before === undefined ? '' : <Money paise={before} />}</td>
          <td className="td num text-right">{before === undefined ? '' : <Change now={now} before={before} />}</td>
        </>
      )}
    </tr>
  );

  return (
    <>
      <Toolbar>
        <p className="text-xs text-ink-muted">Sales are before GST. Cost of goods is what the pieces cost when they were sold.</p>
        <div className="flex gap-2">
          <ExportButton onClick={() => void exportCsv(`profit-and-loss-${range.from}_${range.to}.csv`, profitLossCsv(r))} />
        </div>
      </Toolbar>
      <div className="mb-8 grid grid-cols-4 gap-6">
        <Figure label="Sales" sub={plural(r.invoiceCount, 'invoice')}>
          <Money paise={r.salesPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Gross profit" sub={r.salesPaise > 0 ? `${((r.grossProfitPaise / r.salesPaise) * 100).toFixed(0)}% of sales` : 'No sales'}>
          <Money paise={r.grossProfitPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Expenses">
          <Money paise={r.expensesPaise} fractionDigits={0} />
        </Figure>
        <Figure label={r.netProfitPaise < 0 ? 'Net loss' : 'Net profit'} highlight>
          <Money paise={Math.abs(r.netProfitPaise)} fractionDigits={0} />
        </Figure>
      </div>
      {empty ? (
        <Empty title="Nothing in this period" body="No invoices were issued and no expenses logged between these dates. Try a wider period." />
      ) : (
        <Section title="Profit and loss" note={last ? `Beside the same dates last year (${formatDate(last.range.from)} – ${formatDate(last.range.to)})` : 'Nothing was recorded on the same dates last year, so there is no comparison.'}>
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="th" />
                  <th className="th text-right">This period</th>
                  {last && (
                    <>
                      <th className="th text-right">Last year</th>
                      <th className="th text-right">Change</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                <Row label="Sales (before GST)" now={r.salesPaise} before={last?.salesPaise} />
                <Row label="Cost of goods sold" now={r.costOfGoodsPaise} before={last?.costOfGoodsPaise} />
                <Row label="Gross profit" now={r.grossProfitPaise} before={last?.grossProfitPaise} strong />
                {r.expensesByCategory.map((c) => (
                  <Row key={c.category} indent label={c.category} now={c.paise} before={last ? (last.expensesByCategory.find((x) => x.category.toLowerCase() === c.category.toLowerCase())?.paise ?? 0) : undefined} />
                ))}
                <Row label="Total expenses" now={r.expensesPaise} before={last?.expensesPaise} />
                <Row label={r.netProfitPaise < 0 ? 'Net loss' : 'Net profit'} now={r.netProfitPaise} before={last?.netProfitPaise} strong />
              </tbody>
            </table>
          </Card>
        </Section>
      )}
    </>
  );
}

// ── Margin: by design, colour or customer, with drill-down ──────────────────
const BY_LABEL: Record<MarginBy, string> = { design: 'Design', colour: 'Colour', customer: 'Customer' };

export function MarginTab({ period }: { period: PeriodSpec }) {
  const exportCsv = useReportExport();
  const range = resolvePeriod(period);
  const [by, setBy] = useState<MarginBy>('design');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery(() => api.reportMargin(range, by), [range.from, range.to, by]);
  const drill = useQuery(() => (open ? api.reportMarginDrill(range, by, open) : Promise.resolve([])), [range.from, range.to, by, open]);
  const r = q.data;
  if (q.error && !r) return <ErrorNote>{q.error}</ErrorNote>;
  if (!r) return <Spinner />;

  return (
    <>
      <Toolbar>
        <Segmented
          label="Group by"
          value={by}
          onChange={(v) => {
            setBy(v);
            setOpen(null);
          }}
          options={(Object.keys(BY_LABEL) as MarginBy[]).map((v) => ({ value: v, label: BY_LABEL[v] }))}
        />
        <div className="flex gap-2">
          <ExportButton onClick={() => void exportCsv(`margin-by-${by}-${range.from}_${range.to}.csv`, marginCsv(r))} />
        </div>
      </Toolbar>
      <div className="mb-8 grid grid-cols-4 gap-6">
        <Figure label="Sales" sub={plural(r.totals.pieces, 'piece')}>
          <Money paise={r.totals.revenuePaise} fractionDigits={0} />
        </Figure>
        <Figure label="Cost">
          <Money paise={r.totals.costPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Profit" highlight>
          <Money paise={r.totals.profitPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Margin" sub="Profit as a share of sales">
          {pct(r.totals.marginPercent)}
        </Figure>
      </div>
      {r.rows.length === 0 ? (
        <Empty title="No sales in this period" body="Margins appear once invoices are issued. Try a wider period." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="w-8" />
                <th className="th">{BY_LABEL[by]}</th>
                <th className="th text-right">Pieces</th>
                <th className="th text-right">Sales</th>
                <th className="th text-right">Cost</th>
                <th className="th text-right">Profit</th>
                <th className="th text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((m) => (
                <Fragment key={m.key}>
                  <tr tabIndex={0} onClick={() => setOpen(open === m.key ? null : m.key)} onKeyDown={(e) => e.key === 'Enter' && setOpen(open === m.key ? null : m.key)} className="cursor-pointer border-b border-line/70 transition-colors hover:bg-canvas">
                    <td className="pl-3 text-ink-muted">
                      <ChevronRight className={`h-4 w-4 transition-transform ${open === m.key ? 'rotate-90' : ''}`} aria-hidden />
                    </td>
                    <td className="td">
                      {m.name}
                      <div className="text-xs text-ink-muted">{plural(m.invoiceCount, 'invoice')}</div>
                    </td>
                    <td className="td num text-right">{m.pieces}</td>
                    <td className="td text-right">
                      <Money paise={m.revenuePaise} />
                    </td>
                    <td className="td text-right text-ink-muted">
                      <Money paise={m.costPaise} />
                    </td>
                    <td className="td text-right">
                      <Money paise={m.profitPaise} className={m.profitPaise < 0 ? 'text-status-overdue-fg' : ''} />
                    </td>
                    <td className="td num text-right">{pct(m.marginPercent)}</td>
                  </tr>
                  {open === m.key && (
                    <tr className="border-b border-line/70 bg-canvas">
                      <td />
                      <td colSpan={6} className="px-4 py-3">
                        {drill.loading ? (
                          <Spinner />
                        ) : (
                          <table className="w-full text-xs">
                            <tbody>
                              {(drill.data ?? []).map((l, i) => (
                                <tr key={`${l.invoiceId}-${i}`} tabIndex={0} onClick={() => navigate(paths.invoice(l.invoiceId))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.invoice(l.invoiceId))} className="cursor-pointer border-b border-line/60 last:border-0 hover:text-brand">
                                  <td className="num py-1.5 pr-4">{l.number}</td>
                                  <td className="num py-1.5 pr-4 text-ink-muted">{formatDate(l.date)}</td>
                                  <td className="py-1.5 pr-4">{by === 'customer' ? `${l.design} · ${l.color} ${l.size}` : by === 'design' ? `${l.color} ${l.size} · ${l.customer}` : `${l.design} ${l.size} · ${l.customer}`}</td>
                                  <td className="num py-1.5 pr-4 text-right">{l.qty}</td>
                                  <td className="num py-1.5 text-right">{formatMoney(l.revenuePaise - l.costPaise)} profit</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

// ── Stock movement ──────────────────────────────────────────────────────────
export function MovementTab({ period }: { period: PeriodSpec }) {
  const exportCsv = useReportExport();
  const range = resolvePeriod(period);
  const q = useQuery(() => api.reportMovement(range), [range.from, range.to]);
  const r = q.data;
  if (q.error && !r) return <ErrorNote>{q.error}</ErrorNote>;
  if (!r) return <Spinner />;
  const cell = (n: number, sign = false) => (n === 0 ? <span className="text-ink-muted/50">—</span> : sign && n > 0 ? `+${n}` : n);

  return (
    <>
      <Toolbar>
        <p className="text-xs text-ink-muted">Opening + added + returned − sold − damaged ± adjusted = closing, in pieces.</p>
        <div className="flex gap-2">
          <ExportButton onClick={() => void exportCsv(`stock-movement-${range.from}_${range.to}.csv`, movementCsv(r))} />
        </div>
      </Toolbar>
      {r.rows.length === 0 ? (
        <Empty title="No stock activity" body="Nothing was added, sold or adjusted between these dates, and there was no stock before them." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Design</th>
                {['Opening', 'Added', 'Returned', 'Sold', 'Damaged', 'Adjusted', 'Closing'].map((h) => (
                  <th key={h} className="th text-right">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((m) => (
                <tr key={m.designId} className="border-b border-line/70">
                  <td className="td">
                    <a href={`#${paths.design(m.designId)}`} className="transition-colors hover:text-brand">
                      {m.name}
                    </a>
                  </td>
                  <td className="td num text-right">{m.opening}</td>
                  <td className="td num text-right">{cell(m.added)}</td>
                  <td className="td num text-right">{cell(m.returned)}</td>
                  <td className="td num text-right">{cell(m.sold)}</td>
                  <td className="td num text-right">{cell(m.damaged)}</td>
                  <td className="td num text-right">{cell(m.adjusted, true)}</td>
                  <td className="td num text-right font-medium">{m.closing}</td>
                </tr>
              ))}
              <tr className="bg-canvas">
                <td className="td">All designs</td>
                <td className="td num text-right">{r.totals.opening}</td>
                <td className="td num text-right">{r.totals.added}</td>
                <td className="td num text-right">{r.totals.returned}</td>
                <td className="td num text-right">{r.totals.sold}</td>
                <td className="td num text-right">{r.totals.damaged}</td>
                <td className="td num text-right">{r.totals.adjusted > 0 ? `+${r.totals.adjusted}` : r.totals.adjusted}</td>
                <td className="td num text-right font-medium">{r.totals.closing}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

// ── Fast movers and dead stock ──────────────────────────────────────────────
const CLASS_LABEL: Record<MoverClass, string> = { fast: 'Fast mover', steady: 'Steady', dead: 'Not moving', none: 'No stock' };
const CLASS_TONE: Record<MoverClass, PillTone> = { fast: 'paid', steady: 'neutral', dead: 'overdue', none: 'neutral' };

export function MoversTab() {
  const exportCsv = useReportExport();
  const [days, setDays] = useState<30 | 90 | 180>(90);
  const q = useQuery(() => api.reportMovers(days), [days]);
  const r = q.data;
  if (q.error && !r) return <ErrorNote>{q.error}</ErrorNote>;
  if (!r) return <Spinner />;
  const dead = r.rows.filter((m) => m.class === 'dead');
  const stuck = dead.reduce((s, m) => s + m.stockValuePaise, 0);

  return (
    <>
      <Toolbar>
        <Segmented label="Look back" value={String(days) as '30' | '90' | '180'} onChange={(v) => setDays(Number(v) as 30 | 90 | 180)} options={[{ value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '180', label: 'Last 180 days' }]} />
        <div className="flex gap-2">
          <ExportButton onClick={() => void exportCsv(`fast-movers-and-dead-stock.csv`, moversCsv(r))} />
        </div>
      </Toolbar>
      <div className="mb-8 grid grid-cols-3 gap-6">
        <Figure label="Fast movers" sub="The best third of what sold">
          {r.rows.filter((m) => m.class === 'fast').length}
        </Figure>
        <Figure label="Not moving" sub={`Stock with no sale in ${days} days`}>
          {dead.length}
        </Figure>
        <Figure label="Money sitting still" sub="At cost, in designs not moving" highlight>
          <Money paise={stuck} fractionDigits={0} />
        </Figure>
      </div>
      {r.rows.length === 0 ? (
        <Empty title="No designs yet" body="Add designs under Inventory and they'll be sorted here by how they sell." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Design</th>
                <th className="th">Group</th>
                <th className="th text-right">Sold</th>
                <th className="th text-right">In stock</th>
                <th className="th text-right">Stock lasts</th>
                <th className="th">Last sold</th>
                <th className="th text-right">Stock value</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((m) => (
                <tr key={m.designId} className="border-b border-line/70">
                  <td className="td">
                    <a href={`#${paths.design(m.designId)}`} className="transition-colors hover:text-brand">
                      {m.name}
                    </a>
                  </td>
                  <td className="td">
                    <Pill tone={CLASS_TONE[m.class]}>{CLASS_LABEL[m.class]}</Pill>
                  </td>
                  <td className="td num text-right">{m.sold || dash}</td>
                  <td className="td num text-right">{m.stock}</td>
                  <td className="td num text-right">{m.daysOfStock === null ? dash : m.daysOfStock === 0 ? 'Sold out' : `${m.daysOfStock} days`}</td>
                  <td className="td num whitespace-nowrap text-ink-muted">{m.lastSoldOn ? formatDate(m.lastSoldOn) : 'Never'}</td>
                  <td className="td text-right">
                    <Money paise={m.stockValuePaise} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

// ── Aged receivables ────────────────────────────────────────────────────────
export function ReceivablesTab() {
  const exportCsv = useReportExport();
  const q = useQuery(() => api.duesReport());
  const d = q.data;
  if (q.error && !d) return <ErrorNote>{q.error}</ErrorNote>;
  if (!d) return <Spinner />;

  return (
    <>
      <Toolbar>
        <p className="text-xs text-ink-muted">Who owes what, as of today, by how late each invoice is. It doesn't depend on the period above.</p>
        <div className="flex gap-2">
          <ExportButton onClick={() => void exportCsv('aged-receivables.csv', receivablesCsv(d))} />
        </div>
      </Toolbar>
      <div className="mb-8 grid grid-cols-4 gap-6">
        <Figure label="Not yet due">
          <Money paise={d.currentPaise} fractionDigits={0} />
        </Figure>
        <Figure label="1–30 days late">
          <Money paise={d.days1to30Paise} fractionDigits={0} />
        </Figure>
        <Figure label="31–60 days late">
          <Money paise={d.days31to60Paise} fractionDigits={0} />
        </Figure>
        <Figure label="61+ days late" highlight>
          <Money paise={d.days61plusPaise} fractionDigits={0} />
        </Figure>
      </div>
      {d.rows.length === 0 ? (
        <Empty title="Nobody owes you anything" body="Every issued invoice is paid." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Customer</th>
                <th className="th text-right">Not yet due</th>
                <th className="th text-right">1–30</th>
                <th className="th text-right">31–60</th>
                <th className="th text-right">61+</th>
                <th className="th text-right">Owes</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.customerId ?? 'walk-in'} className="border-b border-line/70">
                  <td className="td">
                    {r.customerId ? (
                      <a href={`#${paths.customer(r.customerId)}`} className="transition-colors hover:text-brand">
                        {r.customerName}
                      </a>
                    ) : (
                      r.customerName
                    )}
                    <div className="text-xs text-ink-muted">
                      {plural(r.openInvoices, 'invoice')}
                      {r.oldestDueDate && <> · oldest due {formatDate(r.oldestDueDate)}</>}
                    </div>
                  </td>
                  {[r.currentPaise, r.days1to30Paise, r.days31to60Paise, r.days61plusPaise].map((p, i) => (
                    <td key={i} className={`td text-right ${p === 0 ? 'text-ink-muted/50' : i === 3 ? 'text-status-overdue-fg' : ''}`}>
                      {p === 0 ? '—' : <Money paise={p} fractionDigits={0} />}
                    </td>
                  ))}
                  <td className="td text-right">
                    <Money paise={r.outstandingPaise} />
                  </td>
                </tr>
              ))}
              <tr className="bg-canvas">
                <td className="td">Total</td>
                <td className="td text-right"><Money paise={d.currentPaise} fractionDigits={0} /></td>
                <td className="td text-right"><Money paise={d.days1to30Paise} fractionDigits={0} /></td>
                <td className="td text-right"><Money paise={d.days31to60Paise} fractionDigits={0} /></td>
                <td className="td text-right"><Money paise={d.days61plusPaise} fractionDigits={0} /></td>
                <td className="td text-right"><Money paise={d.outstandingPaise} /></td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

// ── Day book, cash book, bank book ──────────────────────────────────────────
const BOOK_LABEL: Record<DayBookMode, string> = { all: 'Day book', cash: 'Cash book', bank: 'Bank book' };
const KIND_LABEL = { sale: 'Sale', receipt: 'Received', expense: 'Paid' } as const;
const KIND_TONE: Record<keyof typeof KIND_LABEL, PillTone> = { sale: 'b2b', receipt: 'paid', expense: 'partial' };

export function DayBookTab({ period }: { period: PeriodSpec }) {
  const exportCsv = useReportExport();
  const range = resolvePeriod(period);
  const [mode, setMode] = useState<DayBookMode>('all');
  const q = useQuery(() => api.reportDayBook(range, mode), [range.from, range.to, mode]);
  const b = q.data;
  if (q.error && !b) return <ErrorNote>{q.error}</ErrorNote>;
  if (!b) return <Spinner />;
  const book = mode !== 'all';

  return (
    <>
      <Toolbar>
        <Segmented label="Book" value={mode} onChange={setMode} options={(Object.keys(BOOK_LABEL) as DayBookMode[]).map((m) => ({ value: m, label: BOOK_LABEL[m] }))} />
        <div className="flex gap-2">
          <ExportButton onClick={() => void exportCsv(`${mode === 'all' ? 'day' : mode}-book-${range.from}_${range.to}.csv`, dayBookCsv(b))} />
        </div>
      </Toolbar>
      <div className="mb-8 grid grid-cols-4 gap-6">
        {book ? (
          <Figure label="Opening balance" sub={`On ${formatDate(range.from)}`}>
            <Money paise={b.openingPaise ?? 0} fractionDigits={0} />
          </Figure>
        ) : (
          <Figure label="Invoiced" sub="Sales in this period">
            <Money paise={b.invoicedPaise} fractionDigits={0} />
          </Figure>
        )}
        <Figure label="Money in">
          <Money paise={b.inPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Money out">
          <Money paise={b.outPaise} fractionDigits={0} />
        </Figure>
        <Figure label={book ? 'Closing balance' : 'Net movement'} highlight>
          <Money paise={book ? (b.closingPaise ?? 0) : b.inPaise - b.outPaise} fractionDigits={0} />
        </Figure>
      </div>
      {b.entries.length === 0 ? (
        <Empty title="Nothing recorded" body={book ? 'No money moved this way between these dates.' : 'No sales, payments or expenses between these dates.'} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Date</th>
                <th className="th">Type</th>
                <th className="th">Party</th>
                <th className="th">Method</th>
                {!book && <th className="th text-right">Invoiced</th>}
                <th className="th text-right">In</th>
                <th className="th text-right">Out</th>
                {book && <th className="th text-right">Balance</th>}
              </tr>
            </thead>
            <tbody>
              {b.entries.map((e, i) => (
                <tr key={i} className="border-b border-line/70">
                  <td className="td num whitespace-nowrap text-ink-muted">{formatDate(e.date)}</td>
                  <td className="td">
                    <Pill tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind]}</Pill>
                  </td>
                  <td className="td">
                    {e.party}
                    {e.detail && <div className="text-xs text-ink-muted">{e.detail}</div>}
                  </td>
                  <td className="td text-ink-muted">{e.method ? PAYMENT_METHOD_LABEL[e.method] : '—'}</td>
                  {!book && <td className="td text-right">{e.invoicedPaise ? <Money paise={e.invoicedPaise} /> : dash}</td>}
                  <td className="td text-right">{e.inPaise ? <Money paise={e.inPaise} /> : dash}</td>
                  <td className="td text-right">{e.outPaise ? <Money paise={e.outPaise} /> : dash}</td>
                  {book && (
                    <td className="td text-right">
                      <Money paise={e.balancePaise ?? 0} className={(e.balancePaise ?? 0) < 0 ? 'text-status-overdue-fg' : ''} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
