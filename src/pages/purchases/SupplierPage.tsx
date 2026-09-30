import { Archive, ArrowLeft, FileText, HandCoins, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Figure, InvoicePill, Money, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { navigate, paths } from '../../lib/router';
import { SupplierFormModal } from './SupplierFormModal';
import { SupplierPaymentModal } from './SupplierPaymentModal';

export function SupplierPage({ id }: { id: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const supplier = useQuery(() => api.supplierGet(id), [id]);
  const ledger = useQuery(() => api.supplierLedger(id), [id]);
  const bills = useQuery(() => api.purchaseBillsList({ supplierId: id }), [id]);
  const [dialog, setDialog] = useState<'edit' | 'archive' | 'pay' | null>(null);
  const s = supplier.data;

  const back = (
    <a href={`#${paths.suppliers}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Suppliers
    </a>
  );
  if (supplier.error && !s) {
    return (
      <>
        <PageHeader title="Supplier not found" back={back} />
        <ErrorNote>{supplier.error}</ErrorNote>
      </>
    );
  }
  if (!s) {
    return (
      <>
        <PageHeader title="" back={back} />
        <Spinner />
      </>
    );
  }

  const balance = s.outstandingPaise - s.advancePaise; // + you owe them, - they hold your money
  const address = [s.address, [s.city, s.state, s.pincode].filter(Boolean).join(', ')].filter(Boolean);

  return (
    <>
      <PageHeader
        back={back}
        title={s.name}
        subtitle={[s.phone, s.email].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setDialog('pay')}>
              Pay supplier
            </Button>
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setDialog('edit')}>
              Edit
            </Button>
            <Button variant="danger" icon={<Archive className="h-4 w-4" />} onClick={() => setDialog('archive')}>
              Archive
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-4 gap-6">
        <Figure label={balance > 0 ? 'You owe them' : balance < 0 ? 'Advance with them' : 'Settled'} highlight>
          <Money paise={Math.abs(balance)} fractionDigits={0} />
        </Figure>
        <Figure label="Total billed" sub="Excludes cancelled">
          <Money paise={s.billedPaise} fractionDigits={0} />
        </Figure>
        <Figure label="Paid">
          <Money paise={ledger.data?.paidPaise ?? 0} fractionDigits={0} />
        </Figure>
        <Figure label="Bills">{s.billCount}</Figure>
      </div>
      <div className="mb-8 text-ink-muted">{[s.gstin && `GSTIN ${s.gstin}`, ...address, s.notes].filter(Boolean).join(' · ') || 'No address or GSTIN saved.'}</div>

      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-base">Ledger</h2>
        <span className="text-xs text-ink-muted">Bills add to what you owe; payments reduce it. A minus balance means they hold your advance.</span>
      </div>
      <Card className="mb-8 overflow-x-auto">
        {ledger.data?.entries.length === 0 ? (
          <EmptyState icon={<FileText className="h-6 w-6" />} title="No activity yet" body={`Bills from ${s.name} and your payments to them will build up here as a running statement.`} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Date</th>
                <th className="th">Details</th>
                <th className="th text-right">Billed</th>
                <th className="th text-right">Paid</th>
                <th className="th text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.data?.entries.map((e, i) => {
                const reversal = e.kind === 'bill-cancelled' || e.kind === 'payment-voided';
                return (
                  <tr
                    key={i}
                    tabIndex={e.billId ? 0 : undefined}
                    onClick={() => e.billId && navigate(paths.bill(e.billId))}
                    onKeyDown={(ev) => ev.key === 'Enter' && e.billId && navigate(paths.bill(e.billId))}
                    className={`animate-fade-in border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas ${e.billId ? 'cursor-pointer' : ''} ${reversal ? 'text-ink-muted' : ''}`}
                  >
                    <td className="td num whitespace-nowrap text-ink-muted">{formatDate(e.date)}</td>
                    <td className="td">{e.description}</td>
                    <td className="td text-right">{e.billedPaise ? <Money paise={e.billedPaise} /> : <span className="text-ink-muted/50">-</span>}</td>
                    <td className="td text-right">{e.paidPaise ? <Money paise={e.paidPaise} /> : <span className="text-ink-muted/50">-</span>}</td>
                    <td className={`td text-right ${e.balancePaise < 0 ? 'text-status-partial-fg' : ''}`}>
                      <Money paise={e.balancePaise} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base">Bills</h2>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate(paths.newBill(s.id))}>
          Enter a bill
        </Button>
      </div>
      <Card className="overflow-x-auto">
        {bills.data?.length === 0 ? (
          <EmptyState icon={<FileText className="h-6 w-6" />} title="No bills yet" body={`Bills you enter from ${s.name} will be listed here.`} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Bill</th>
                <th className="th">Date</th>
                <th className="th text-right">Total</th>
                <th className="th text-right">Balance</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {bills.data?.map((b) => (
                <tr key={b.id} tabIndex={0} onClick={() => navigate(paths.bill(b.id))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.bill(b.id))} className="animate-fade-in cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas">
                  <td className="td num whitespace-nowrap">{b.billNumber}</td>
                  <td className="td num whitespace-nowrap text-ink-muted">{formatDate(b.billDate)}</td>
                  <td className="td text-right"><Money paise={b.totalPaise} className={b.status === 'cancelled' ? 'text-ink-muted line-through' : ''} /></td>
                  <td className="td text-right">{b.status === 'cancelled' ? <span className="text-ink-muted/50">-</span> : <Money paise={b.totalPaise - b.paidPaise} />}</td>
                  <td className="td"><InvoicePill status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {dialog === 'edit' && <SupplierFormModal supplier={s} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} />}
      {dialog === 'pay' && <SupplierPaymentModal supplier={s} onClose={() => setDialog(null)} />}
      {dialog === 'archive' && (
        <ConfirmDialog
          title={`Archive ${s.name}?`}
          confirmLabel="Archive supplier"
          danger
          body={<p>They disappear from your supplier list. Bills already entered keep their details. {s.outstandingPaise > 0 && `You still owe ${formatMoney(s.outstandingPaise)}, so this will be refused until it is paid.`}</p>}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.supplierArchive(s.id);
            refresh();
            toast.success(`${s.name} archived`);
            navigate(paths.suppliers);
          }}
        />
      )}
    </>
  );
}
