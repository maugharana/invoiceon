import { ChevronRight, Table2 } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { gstB2bCsv, gstB2cCsv, gstCsv, gstHsnCsv, salesCsv, stockCsv } from '../../../shared/csv';
import { formatDate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { PERIOD_LABEL, PERIOD_PRESETS, resolvePeriod, type PeriodPreset, type PeriodSpec } from '../../../shared/periods';
import { PAYMENT_METHOD_LABEL } from '../../../shared/types';
import { SalesChart, bucketLabel } from '../../components/SalesChart';
import { AccountBookTab, DayBookTab, MarginTab, MoversTab, MovementTab, ProfitTab, PurchasesTab, QuotesTab, ReceivablesTab } from './MoreReports';
import { ExportButton, PrintButton, Section, useReportExport } from './parts';
import { Button, Card, EmptyState, ErrorNote, Field, Figure, Input, Money, PageHeader, Segmented, Spinner, TypePill } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths, type ReportTab } from '../../lib/router';

// ── Shell: title, tabs, period ──────────────────────────────────────────────
const TABS: { id: ReportTab; label: string }[] = [
  { id: 'sales', label: 'Sales' },
  { id: 'profit', label: 'Profit & loss' },
  { id: 'margin', label: 'Margins' },
  { id: 'gst', label: 'GST' },
  { id: 'daybook', label: 'Day & cash book' },
  { id: 'stock', label: 'Stock valuation' },
  { id: 'movement', label: 'Stock movement' },
  { id: 'movers', label: 'Fast & slow' },
  { id: 'receivables', label: 'Receivables' },
  { id: 'quotes', label: 'Quotes' },
  { id: 'purchases', label: 'Purchases & input GST' },
  { id: 'accountbook', label: 'Account book' },
];

/** These reports aren't about a stretch of dates: stock is as of a day, the rest look back a fixed way or at today. */
const NO_PERIOD: ReportTab[] = ['stock', 'movers', 'receivables'];

function PeriodPicker({ tab, period }: { tab: ReportTab; period: PeriodSpec }) {
  const range = resolvePeriod(period);
  const go = (spec: PeriodSpec) => navigate(paths.reports(tab, spec));
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3 print:hidden">
      <Segmented
        label="Period"
        value={period.preset}
        onChange={(preset: PeriodPreset) => go(preset === 'custom' ? { preset, from: range.from, to: range.to } : { preset })}
        options={PERIOD_PRESETS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
      />
      {period.preset === 'custom' && (
        <div className="flex items-end gap-2">
          <Field label="From">
            <Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && go({ preset: 'custom', from: e.target.value, to: range.to })} className="num h-8 w-40" />
          </Field>
          <Field label="To">
            <Input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && go({ preset: 'custom', from: range.from, to: e.target.value })} className="num h-8 w-40" />
          </Field>
        </div>
      )}
      <span className="num pb-1.5 text-xs text-ink-muted">
        {formatDate(range.from)} – {formatDate(range.to)}
      </span>
    </div>
  );
}

function ReportsShell({ tab, period, asOf, children }: { tab: ReportTab; period: PeriodSpec; asOf: string | null; children: ReactNode }) {
  return (
    <>
      <PageHeader title="Reports" subtitle="How the business is doing — sales, profit, GST, cash and what's on the shelf." actions={<PrintButton />} />
      <div className="mb-6 flex gap-5 overflow-x-auto border-b border-line print:hidden" role="tablist">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#${paths.reports(t.id, NO_PERIOD.includes(t.id) ? undefined : period, t.id === 'stock' ? asOf : undefined)}`}
            role="tab"
            aria-selected={tab === t.id}
            className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 transition-colors duration-150 ${tab === t.id ? 'border-brand font-medium text-brand' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            {t.label}
          </a>
        ))}
      </div>
      {children}
    </>
  );
}

// ── Sales ───────────────────────────────────────────────────────────────────
function SalesTab({ period }: { period: PeriodSpec }) {
  const exportCsv = useReportExport();
  const range = resolvePeriod(period);
  const report = useQuery(() => api.reportSales(range), [range.from, range.to]);
  const [asTable, setAsTable] = useState(false);
  const r = report.data;

  if (report.error && !r) return <ErrorNote>{report.error}</ErrorNote>;
  if (!r) return <Spinner />;
  const empty = r.invoiceCount === 0 && r.paymentCount === 0;

  return (
    <>
      <div className="mb-8 grid grid-cols-4 gap-6">
        <Figure label="Invoiced" sub={`${plural(r.invoiceCount, 'invoice')} · ${formatMoney(r.taxablePaise, { fractionDigits: 0 })} before GST`} highlight>
          <Money paise={r.invoicedPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Collected" sub={`${plural(r.paymentCount, 'payment')} received`}>
          <Money paise={r.collectedPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Gross profit" sub={r.marginPercent === null ? 'No sales yet' : `${r.marginPercent.toFixed(0)}% of sales before GST`}>
          <Money paise={r.grossProfitPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Still unpaid" sub="On invoices from this period">
          <Money paise={r.stillUnpaidPaise} fractionDigits={0} />
        </Figure>
      </div>

      {empty ? (
        <Card>
          <EmptyState icon={<Table2 className="h-6 w-6" />} title="Nothing in this period" body="No invoices were issued and no payments received between these dates. Try a wider period." />
        </Card>
      ) : (
        <>
          <Section
            title="Invoiced vs collected"
            note="Invoiced counts each invoice on the day it was issued; collected counts each payment on the day it arrived. They differ whenever customers pay later, or in advance."
            actions={
              <div className="flex items-center gap-2">
                <Button icon={<Table2 className="h-4 w-4" />} onClick={() => setAsTable((v) => !v)}>
                  {asTable ? 'Show chart' : 'View as table'}
                </Button>
                <ExportButton onClick={() => void exportCsv(`Sales ${range.from} to ${range.to}.csv`, salesCsv(r))} />
              </div>
            }
          >
            <Card className="p-6">
              {asTable ? (
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="th">{r.granularity === 'day' ? 'Date' : 'Month'}</th>
                        <th className="th text-right">Invoices</th>
                        <th className="th text-right">Invoiced</th>
                        <th className="th text-right">Collected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.series.map((p) => (
                        <tr key={p.key} className="border-b border-line/70 last:border-0">
                          <td className="td">{bucketLabel(p.key, r.granularity, true)}</td>
                          <td className="td num text-right">{p.invoices}</td>
                          <td className="td text-right"><Money paise={p.invoicedPaise} /></td>
                          <td className="td text-right"><Money paise={p.collectedPaise} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <SalesChart series={r.series} granularity={r.granularity} />
              )}
            </Card>
          </Section>

          <div className="mb-8 grid grid-cols-2 gap-6">
            <Section title="Best-selling designs" note="Sales are before GST, after any discount.">
              <Card className="overflow-x-auto">
                {r.topDesigns.length === 0 ? (
                  <p className="p-6 text-ink-muted">No items sold in this period.</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="th">Design</th>
                        <th className="th text-right">Pieces</th>
                        <th className="th text-right">Sales</th>
                        <th className="th text-right">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.topDesigns.map((d) => (
                        <tr key={d.designId || d.name} className="border-b border-line/70 last:border-0">
                          <td className="td">{d.name}</td>
                          <td className="td num text-right">{d.pieces}</td>
                          <td className="td text-right"><Money paise={d.revenuePaise} fractionDigits={0} /></td>
                          <td className={`td text-right ${d.profitPaise < 0 ? 'text-status-overdue-fg' : ''}`}><Money paise={d.profitPaise} fractionDigits={0} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </Section>

            <Section title="Top customers">
              <Card className="overflow-x-auto">
                {r.topCustomers.length === 0 ? (
                  <p className="p-6 text-ink-muted">No invoices in this period.</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="th">Customer</th>
                        <th className="th text-right">Invoices</th>
                        <th className="th text-right">Invoiced</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.topCustomers.map((c) => (
                        <tr key={c.customerId ?? 'walk-in'} className="border-b border-line/70 last:border-0">
                          <td className="td">{c.customerId ? <a href={`#${paths.customer(c.customerId)}`} className="transition-colors hover:text-brand">{c.name}</a> : c.name}</td>
                          <td className="td num text-right">{c.invoices}</td>
                          <td className="td text-right"><Money paise={c.invoicedPaise} fractionDigits={0} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </Section>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-6">
            <Section title="Business vs retail">
              <Card className="overflow-x-auto">
                <table className="w-full">
                  <tbody>
                    {r.byType.map((t) => (
                      <tr key={t.type} className="border-b border-line/70 last:border-0">
                        <td className="td"><TypePill type={t.type} /></td>
                        <td className="td num text-right text-ink-muted">{plural(t.invoices, 'invoice')}</td>
                        <td className="td text-right"><Money paise={t.invoicedPaise} fractionDigits={0} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </Section>
            <Section title="How customers paid" note="Money received in this period, by method.">
              <Card className="overflow-x-auto">
                {r.byMethod.length === 0 ? (
                  <p className="p-6 text-ink-muted">No payments received in this period.</p>
                ) : (
                  <table className="w-full">
                    <tbody>
                      {r.byMethod.map((m) => (
                        <tr key={m.method} className="border-b border-line/70 last:border-0">
                          <td className="td">{PAYMENT_METHOD_LABEL[m.method]}</td>
                          <td className="td num text-right text-ink-muted">{plural(m.count, 'payment')}</td>
                          <td className="td text-right"><Money paise={m.paise} fractionDigits={0} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </Section>
          </div>
          {r.cancelledCount > 0 && (
            <p className="text-xs text-ink-muted">
              {plural(r.cancelledCount, 'cancelled invoice')} ({formatMoney(r.cancelledPaise, { fractionDigits: 0 })}) dated in this period {r.cancelledCount === 1 ? 'is' : 'are'} left out of these figures.
            </p>
          )}
        </>
      )}
    </>
  );
}

// ── GST ─────────────────────────────────────────────────────────────────────
function GstTab({ period }: { period: PeriodSpec }) {
  const exportCsv = useReportExport();
  const range = resolvePeriod(period);
  const report = useQuery(() => api.reportGst(range), [range.from, range.to]);
  const r = report.data;

  if (report.error && !r) return <ErrorNote>{report.error}</ErrorNote>;
  if (!r) return <Spinner />;
  const t = r.totals;
  const stamp = `${range.from} to ${range.to}`;

  return (
    <>
      <div className="mb-8 grid grid-cols-4 gap-6">
        <Figure label="Taxable value" sub={`${plural(t.invoices, 'invoice')}, after discounts`}>
          <Money paise={t.taxablePaise} fractionDigits={0} />
        </Figure>
        <Figure label="GST collected" sub="CGST + SGST + IGST" highlight>
          <Money paise={t.taxPaise} fractionDigits={0} />
        </Figure>
        <Figure label="CGST + SGST" sub={`${formatMoney(t.cgstPaise, { fractionDigits: 0 })} + ${formatMoney(t.sgstPaise, { fractionDigits: 0 })}`}>
          <Money paise={t.cgstPaise + t.sgstPaise} fractionDigits={0} />
        </Figure>
        <Figure label="IGST" sub="Sales to other states">
          <Money paise={t.igstPaise} fractionDigits={0} />
        </Figure>
      </div>

      {t.invoices === 0 ? (
        <Card>
          <EmptyState icon={<Table2 className="h-6 w-6" />} title="No invoices in this period" body="GST is reported by invoice date. Try a wider period." />
        </Card>
      ) : (
        <>
          <div className="mb-6 flex items-center justify-between">
            <p className="text-xs text-ink-muted">
              By invoice date — the day GST becomes due, not the day the customer pays.
              {r.cancelledCount > 0 && ` ${plural(r.cancelledCount, 'cancelled invoice')} left out.`}
            </p>
            <ExportButton label="Export all (CSV)" onClick={() => void exportCsv(`GST ${stamp}.csv`, gstCsv(r))} />
          </div>

          <Section title="Business and retail">
            <Card className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Type</th>
                    <th className="th text-right">Invoices</th>
                    <th className="th text-right">Taxable value</th>
                    <th className="th text-right">CGST</th>
                    <th className="th text-right">SGST</th>
                    <th className="th text-right">IGST</th>
                    <th className="th text-right">Invoice value</th>
                  </tr>
                </thead>
                <tbody>
                  {([['B2B', r.b2b], ['B2C', r.b2c]] as const).map(([type, row]) => (
                    <tr key={type} className="border-b border-line/70">
                      <td className="td"><TypePill type={type} /></td>
                      <td className="td num text-right">{row.invoices}</td>
                      <td className="td text-right"><Money paise={row.taxablePaise} /></td>
                      <td className="td text-right"><Money paise={row.cgstPaise} /></td>
                      <td className="td text-right"><Money paise={row.sgstPaise} /></td>
                      <td className="td text-right"><Money paise={row.igstPaise} /></td>
                      <td className="td text-right"><Money paise={row.invoiceValuePaise} /></td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="td">Total</td>
                    <td className="td num text-right">{t.invoices}</td>
                    <td className="td text-right"><Money paise={t.taxablePaise} /></td>
                    <td className="td text-right"><Money paise={t.cgstPaise} /></td>
                    <td className="td text-right"><Money paise={t.sgstPaise} /></td>
                    <td className="td text-right"><Money paise={t.igstPaise} /></td>
                    <td className="td text-right"><Money paise={t.invoiceValuePaise} /></td>
                  </tr>
                </tbody>
              </table>
            </Card>
          </Section>

          <Section title="By HSN code" note="Taxable value and tax for each HSN, with any invoice discount shared out across its items." actions={<ExportButton label="HSN CSV" onClick={() => void exportCsv(`GST HSN ${stamp}.csv`, gstHsnCsv(r))} />}>
            <Card className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">HSN</th>
                    <th className="th text-right">Pieces</th>
                    <th className="th text-right">Taxable value</th>
                    <th className="th text-right">CGST</th>
                    <th className="th text-right">SGST</th>
                    <th className="th text-right">IGST</th>
                    <th className="th text-right">Total tax</th>
                  </tr>
                </thead>
                <tbody>
                  {r.hsn.map((h) => (
                    <tr key={h.hsn} className="border-b border-line/70 last:border-0">
                      <td className="td num">{h.hsn}</td>
                      <td className="td num text-right">{h.qty}</td>
                      <td className="td text-right"><Money paise={h.taxablePaise} /></td>
                      <td className="td text-right"><Money paise={h.cgstPaise} /></td>
                      <td className="td text-right"><Money paise={h.sgstPaise} /></td>
                      <td className="td text-right"><Money paise={h.igstPaise} /></td>
                      <td className="td text-right"><Money paise={h.taxPaise} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </Section>

          <Section title="B2B invoices" note="Invoice by invoice, with the buyer's GSTIN — the register for your GST return." actions={<ExportButton label="B2B CSV" onClick={() => void exportCsv(`GST B2B ${stamp}.csv`, gstB2bCsv(r))} />}>
            <Card className="overflow-x-auto">
              {r.b2bRegister.length === 0 ? (
                <p className="p-6 text-ink-muted">No B2B invoices in this period.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="th">Invoice</th>
                      <th className="th">Date</th>
                      <th className="th">Buyer</th>
                      <th className="th">GSTIN</th>
                      <th className="th text-right">Taxable</th>
                      <th className="th text-right">Tax</th>
                      <th className="th text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.b2bRegister.map((i) => (
                      <tr key={i.invoiceId} tabIndex={0} onClick={() => navigate(paths.invoice(i.invoiceId))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.invoice(i.invoiceId))} className="cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas">
                        <td className="td num whitespace-nowrap">{i.number}</td>
                        <td className="td num whitespace-nowrap text-ink-muted">{formatDate(i.date)}</td>
                        <td className="td">
                          {i.customer}
                          <div className="text-xs text-ink-muted">{i.placeOfSupply}</div>
                        </td>
                        <td className="td num text-xs text-ink-muted">{i.gstin}</td>
                        <td className="td text-right"><Money paise={i.taxablePaise} /></td>
                        <td className="td text-right"><Money paise={i.cgstPaise + i.sgstPaise + i.igstPaise} /></td>
                        <td className="td text-right"><Money paise={i.totalPaise} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </Section>

          <Section title="B2C by state" note="Retail sales roll up by state and rate — no need to list each bill." actions={<ExportButton label="B2C CSV" onClick={() => void exportCsv(`GST B2C ${stamp}.csv`, gstB2cCsv(r))} />}>
            <Card className="overflow-x-auto">
              {r.b2cByState.length === 0 ? (
                <p className="p-6 text-ink-muted">No B2C invoices in this period.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="th">Place of supply</th>
                      <th className="th text-right">Rate</th>
                      <th className="th text-right">Invoices</th>
                      <th className="th text-right">Taxable value</th>
                      <th className="th text-right">CGST</th>
                      <th className="th text-right">SGST</th>
                      <th className="th text-right">IGST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.b2cByState.map((s) => (
                      <tr key={`${s.placeOfSupply}${s.ratePercent}`} className="border-b border-line/70 last:border-0">
                        <td className="td">{s.placeOfSupply}</td>
                        <td className="td num text-right">{s.ratePercent}%</td>
                        <td className="td num text-right">{s.invoices}</td>
                        <td className="td text-right"><Money paise={s.taxablePaise} /></td>
                        <td className="td text-right"><Money paise={s.cgstPaise} /></td>
                        <td className="td text-right"><Money paise={s.sgstPaise} /></td>
                        <td className="td text-right"><Money paise={s.igstPaise} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </Section>
        </>
      )}
    </>
  );
}

// ── Stock valuation ─────────────────────────────────────────────────────────
function StockTab({ asOf }: { asOf: string | null }) {
  const exportCsv = useReportExport();
  const today = todayIso();
  const date = asOf ?? today;
  const report = useQuery(() => api.reportStock(date), [date]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const r = report.data;

  if (report.error && !r) return <ErrorNote>{report.error}</ErrorNote>;
  if (!r) return <Spinner />;
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const potential = r.retailValuePaise - r.costValuePaise;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-end gap-3">
          <Field label="Value stock as of">
            <Input type="date" value={date} max={today} onChange={(e) => e.target.value && navigate(paths.reports('stock', undefined, e.target.value === today ? null : e.target.value))} className="num h-8 w-40" />
          </Field>
          {asOf && asOf < today && (
            <button type="button" onClick={() => navigate(paths.reports('stock'))} className="pb-1.5 text-xs text-brand transition-colors hover:text-brand-hover">
              Back to today
            </button>
          )}
        </div>
        <ExportButton onClick={() => void exportCsv(`Stock valuation ${r.asOf}.csv`, stockCsv(r))} />
      </div>

      <div className="mb-8 grid grid-cols-4 gap-6">
        <Figure label="Value at cost" sub="What it cost to make or buy" highlight>
          <Money paise={r.costValuePaise} fractionDigits={0} />
        </Figure>
        <Figure label="Value at selling price" sub={`${formatMoney(potential, { fractionDigits: 0 })} above cost, before GST`}>
          <Money paise={r.retailValuePaise} fractionDigits={0} />
        </Figure>
        <Figure label="Pieces in stock" sub={`${plural(r.designCount, 'design')} · ${plural(r.variantCount, 'variant')}`}>
          {r.pieces}
        </Figure>
        <Figure label="Variants out of stock" sub={r.outOfStockVariants === 0 ? 'Nothing is out' : 'Nothing on the shelf'}>
          {r.outOfStockVariants}
        </Figure>
      </div>

      {r.asOf < today && <p className="mb-4 text-xs text-ink-muted">Quantities are rebuilt from the stock history as it stood at the end of {formatDate(r.asOf)}. Values use each variant's current cost, since past costs aren't kept.</p>}

      {r.rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Table2 className="h-6 w-6" />} title="No stock to value" body="Add designs and stock under Inventory and they'll be valued here." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="w-10" />
                <th className="th">Design</th>
                <th className="th text-right">Pieces</th>
                <th className="th text-right">Value at cost</th>
                <th className="th text-right">At selling price</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((d) => (
                <Fragment key={d.designId}>
                  <tr className="cursor-pointer border-b border-line/70 transition-colors duration-150 hover:bg-canvas" tabIndex={0} aria-expanded={open.has(d.designId)} onClick={() => toggle(d.designId)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(d.designId)}>
                    <td className="td pr-0 text-ink-muted"><ChevronRight className={`h-4 w-4 transition-transform duration-150 ${open.has(d.designId) ? 'rotate-90' : ''}`} aria-hidden /></td>
                    <td className="td">
                      {d.name}
                      <div className="text-xs text-ink-muted">{d.code}{d.fabric && ` · ${d.fabric}`}</div>
                    </td>
                    <td className="td num text-right">{d.pieces}</td>
                    <td className="td text-right"><Money paise={d.costValuePaise} /></td>
                    <td className="td text-right"><Money paise={d.retailValuePaise} /></td>
                  </tr>
                  {open.has(d.designId) &&
                    d.variants.map((v) => (
                      <tr key={v.variantId} className={`animate-fade-in border-b border-line/50 bg-canvas/60 ${v.pieces <= 0 ? 'text-ink-muted' : ''}`}>
                        <td />
                        <td className="td pl-6 text-sm">
                          {v.color} · {v.size}
                          <div className="text-xs text-ink-muted">
                            {v.sku} · {v.lastSoldOn ? `last sold ${formatDate(v.lastSoldOn)}` : 'never sold'}
                          </div>
                        </td>
                        <td className="td num text-right">{v.pieces}</td>
                        <td className="td text-right">
                          <Money paise={v.costValuePaise} />
                          <div className="text-xs text-ink-muted">{formatMoney(v.unitCostPaise)} each</div>
                        </td>
                        <td className="td text-right">
                          <Money paise={v.retailValuePaise} />
                          <div className="text-xs text-ink-muted">{formatMoney(v.sellPricePaise)} each</div>
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
              <tr className="font-medium">
                <td />
                <td className="td">Total</td>
                <td className="td num text-right">{r.pieces}</td>
                <td className="td text-right"><Money paise={r.costValuePaise} /></td>
                <td className="td text-right"><Money paise={r.retailValuePaise} /></td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

export function ReportsPage({ tab, period, asOf }: { tab: ReportTab; period: PeriodSpec; asOf: string | null }) {
  return (
    <ReportsShell tab={tab} period={period} asOf={asOf}>
      {!NO_PERIOD.includes(tab) && <PeriodPicker tab={tab} period={period} />}
      {!NO_PERIOD.includes(tab) && (
        <p className="num mb-4 hidden text-xs text-ink-muted print:block">
          {formatDate(resolvePeriod(period).from)} – {formatDate(resolvePeriod(period).to)}
        </p>
      )}
      {tab === 'sales' && <SalesTab period={period} />}
      {tab === 'profit' && <ProfitTab period={period} />}
      {tab === 'margin' && <MarginTab period={period} />}
      {tab === 'gst' && <GstTab period={period} />}
      {tab === 'daybook' && <DayBookTab period={period} />}
      {tab === 'stock' && <StockTab asOf={asOf} />}
      {tab === 'movement' && <MovementTab period={period} />}
      {tab === 'movers' && <MoversTab />}
      {tab === 'receivables' && <ReceivablesTab />}
      {tab === 'quotes' && <QuotesTab period={period} />}
      {tab === 'purchases' && <PurchasesTab period={period} />}
      {tab === 'accountbook' && <AccountBookTab period={period} />}
    </ReportsShell>
  );
}
