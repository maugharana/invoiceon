import { ArrowLeft, Ban, HandCoins } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { BILL_LINE_KIND_LABEL, PAYMENT_METHOD_LABEL } from '../../../shared/types';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Figure, Input, InvoicePill, Money, PageHeader, Pill, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { paths } from '../../lib/router';
import { SupplierPaymentModal } from './SupplierPaymentModal';

const rate = (r: number) => `${+r.toFixed(2)}%`;

export function BillPage({ id }: { id: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const query = useQuery(() => api.purchaseBillGet(id), [id]);
  const b = query.data;
  const supplier = useQuery(() => (b ? api.supplierGet(b.supplierId) : Promise.resolve(null)), [b?.supplierId]);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const back = (
    <a href={`#${paths.purchases()}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Purchases
    </a>
  );
  if (query.error && !b) {
    return (
      <>
        <PageHeader title="Bill not found" back={back} />
        <ErrorNote>{query.error}</ErrorNote>
      </>
    );
  }
  if (!b) {
    return (
      <>
        <PageHeader title="" back={back} />
        <Spinner />
      </>
    );
  }

  const cancelled = b.status === 'cancelled';
  const balance = b.totalPaise - b.paidPaise;
  const advance = supplier.data?.advancePaise ?? 0;
  const totalTax = b.cgstPaise + b.sgstPaise + b.igstPaise;

  async function applyAdvance() {
    setBusy(true);
    try {
      const after = await api.purchaseBillApplyAdvance(id);
      refresh();
      toast.success(`${formatMoney(after.paidPaise - b!.paidPaise)} of advance applied`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            <span className="num">{b.billNumber}</span>
            <InvoicePill status={b.status} />
            {b.itcEligible && totalTax > 0 && <Pill tone="b2b">Input credit</Pill>}
          </span>
        }
        subtitle={
          <>
            <a href={`#${paths.supplier(b.supplierId)}`} className="transition-colors hover:text-brand">
              {b.supplierName}
            </a>{' '}
            · {formatDate(b.billDate)}
            {b.dueDate && <> · due {formatDate(b.dueDate)}</>}
          </>
        }
        actions={
          !cancelled && (
            <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setCancelling(true)}>
              Cancel bill
            </Button>
          )
        }
      />

      {!cancelled && (
        <Card className="mb-6 p-6">
          <div className="grid grid-cols-[auto_1fr] gap-10">
            <div className="grid grid-cols-3 gap-8">
              <Figure label="Bill total">
                <Money paise={b.totalPaise} fractionDigits={0} />
              </Figure>
              <Figure label="Paid">
                <Money paise={b.paidPaise} fractionDigits={0} />
              </Figure>
              <Figure label="Balance due" highlight={balance > 0} sub={balance === 0 ? 'Paid in full' : undefined}>
                <Money paise={balance} fractionDigits={0} />
              </Figure>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-medium text-ink-muted">Payments</div>
                {balance > 0 && supplier.data && (
                  <Button className="h-8 px-3 text-xs" icon={<HandCoins className="h-3.5 w-3.5" />} onClick={() => setPaying(true)}>
                    Pay this bill
                  </Button>
                )}
              </div>
              {b.payments.length === 0 ? (
                <p className="text-ink-muted">Nothing paid yet.</p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {b.payments.map((p) => (
                    <li key={p.paymentId} className="flex items-center justify-between py-1.5">
                      <span>
                        <span className="num text-ink-muted">{formatDate(p.paidOn)}</span>
                        <span className="ml-3">{PAYMENT_METHOD_LABEL[p.method]}</span>
                        {p.reference && <span className="num ml-2 text-xs text-ink-muted">{p.reference}</span>}
                      </span>
                      <Money paise={p.amountPaise} />
                    </li>
                  ))}
                </ul>
              )}
              {balance > 0 && advance > 0 && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-status-partial-bg px-3 py-2 text-status-partial-fg">
                  <span>
                    You hold <Money paise={advance} /> of advance with {b.supplierName}.
                  </span>
                  <button type="button" disabled={busy} onClick={() => void applyAdvance()} className="ml-4 rounded-lg px-2 py-1 transition-colors hover:bg-white/50 disabled:opacity-50">
                    Apply to this bill
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
      {cancelled && (
        <div className="mb-6 rounded-lg bg-status-neutral-bg px-4 py-3 text-ink-muted">
          Cancelled{b.cancelledAt ? ` on ${formatDate(b.cancelledAt.slice(0, 10))}` : ''}
          {b.cancelReason ? `: ${b.cancelReason}` : ''}. It stays on record but counts for nothing.
        </div>
      )}

      <Card className="mb-6 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className="th">Item</th>
              <th className="th">Kind</th>
              <th className="th text-right">Qty</th>
              <th className="th text-right">Price</th>
              <th className="th text-right">GST</th>
              <th className="th text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {b.lines.map((l) => (
              <tr key={l.id} className="border-b border-line/70 last:border-0">
                <td className="td">
                  {l.description}
                  {l.hsn && <div className="num text-xs text-ink-muted">HSN {l.hsn}</div>}
                </td>
                <td className="td text-ink-muted">{BILL_LINE_KIND_LABEL[l.kind]}</td>
                <td className="td num text-right">
                  {l.qty} {l.unit}
                </td>
                <td className="td text-right"><Money paise={l.unitPricePaise} /></td>
                <td className="td num text-right">{rate(l.gstRatePercent)}</td>
                <td className="td text-right"><Money paise={l.amountPaise} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-2 gap-6">
        <div>
          {b.notes && (
            <Card className="p-5">
              <div className="mb-1 text-xs font-medium text-ink-muted">Notes</div>
              <p className="whitespace-pre-line">{b.notes}</p>
            </Card>
          )}
        </div>
        <Card className="p-5">
          <dl className="space-y-1.5">
            <div className="flex justify-between"><dt className="text-ink-muted">Taxable value</dt><dd><Money paise={b.taxablePaise} /></dd></div>
            {b.taxSummary.map((g) =>
              b.intraState ? (
                <div key={g.ratePercent} className="space-y-1.5">
                  <div className="flex justify-between"><dt className="text-ink-muted">CGST @ {rate(g.ratePercent / 2)}</dt><dd><Money paise={g.cgstPaise} /></dd></div>
                  <div className="flex justify-between"><dt className="text-ink-muted">SGST @ {rate(g.ratePercent / 2)}</dt><dd><Money paise={g.sgstPaise} /></dd></div>
                </div>
              ) : (
                <div key={g.ratePercent} className="flex justify-between"><dt className="text-ink-muted">IGST @ {rate(g.ratePercent)}</dt><dd><Money paise={g.igstPaise} /></dd></div>
              ),
            )}
            {b.roundOffPaise !== 0 && <div className="flex justify-between text-ink-muted"><dt>Round off</dt><dd className="num">{b.roundOffPaise < 0 ? '-' : '+'}{formatMoney(Math.abs(b.roundOffPaise))}</dd></div>}
            <div className="flex justify-between border-t border-line pt-2 text-base font-medium"><dt>Total</dt><dd><Money paise={b.totalPaise} /></dd></div>
          </dl>
          <p className="mt-3 text-xs text-ink-muted">
            {b.placeOfSupply} · {b.intraState ? 'CGST + SGST' : 'IGST'} · {b.itcEligible ? 'GST on this bill can be claimed as input credit' : 'no input credit claimed'}
          </p>
        </Card>
      </div>

      {paying && supplier.data && <SupplierPaymentModal supplier={supplier.data} bill={b} onClose={() => setPaying(false)} />}
      {cancelling && (
        <ConfirmDialog
          title={`Cancel bill ${b.billNumber}?`}
          confirmLabel="Cancel bill"
          danger
          body={
            <div className="space-y-4">
              <p>
                {b.lines.some((l) => l.kind === 'variant') ? 'Sarees it brought into stock go out again (this fails if some are already sold). ' : ''}The bill stays on record but counts for nothing.
                {b.paidPaise > 0 && <> The {formatMoney(b.paidPaise)} you paid against it stays with {b.supplierName} as an advance.</>}
              </p>
              <Field label="Reason">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional, e.g. entered twice" data-autofocus />
              </Field>
            </div>
          }
          onClose={() => setCancelling(false)}
          onConfirm={async () => {
            await api.purchaseBillCancel(b.id, reason);
            refresh();
            toast.success(`Bill ${b.billNumber} cancelled`);
          }}
        />
      )}
    </>
  );
}
