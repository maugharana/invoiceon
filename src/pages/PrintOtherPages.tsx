import { ReceiptDocument, receiptNumber } from '../components/ReceiptDocument';
import { PrintShell } from '../components/PrintShell';
import { StatementDocument } from '../components/StatementDocument';
import { api } from '../lib/api';
import { useQuery } from '../lib/data';

/** A customer's statement, bare. PDF export and printing open this route (see PrintShell). */
export function PrintStatementPage({ customerId }: { customerId: string }) {
  const ledger = useQuery(() => api.customerLedger(customerId), [customerId]);
  const settings = useQuery(() => api.getSettings());
  if (ledger.error) return <p className="p-8 text-status-overdue-fg">{ledger.error}</p>;
  if (!ledger.data || !settings.data) return null;
  return (
    <PrintShell ready title={`Statement - ${ledger.data.customer.name}`} noun="statement">
      <StatementDocument ledger={ledger.data} settings={settings.data} />
    </PrintShell>
  );
}

/** A payment receipt, bare. */
export function PrintReceiptPage({ paymentId }: { paymentId: string }) {
  const payment = useQuery(() => api.paymentGet(paymentId), [paymentId]);
  const settings = useQuery(() => api.getSettings());
  if (payment.error) return <p className="p-8 text-status-overdue-fg">{payment.error}</p>;
  if (!payment.data || !settings.data) return null;
  return (
    <PrintShell ready title={`Receipt ${receiptNumber(payment.data)}`} noun="receipt">
      <ReceiptDocument payment={payment.data} settings={settings.data} />
    </PrintShell>
  );
}
