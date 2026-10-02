import { CreditNoteDocument } from '../../components/CreditNoteDocument';
import { InvoiceDocument } from '../../components/InvoiceDocument';
import { PrintShell } from '../../components/PrintShell';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { proformaAsInvoice } from '../../lib/proforma';

/** The bare invoice or proforma, with no app chrome. PDF export and printing open this route and capture it (see PrintShell). */
export function PrintInvoicePage({ id, kind = 'invoice' }: { id: string; kind?: 'invoice' | 'proforma' }) {
  const proforma = kind === 'proforma';
  const query = useQuery(() => (proforma ? api.proformaGet(id).then(proformaAsInvoice) : api.invoiceGet(id)), [id, proforma]);
  const invoice = query.data;

  if (query.error) return <p className="p-8 text-status-overdue-fg">{query.error}</p>;
  if (!invoice) return null;
  return (
    <PrintShell ready title={`${proforma ? 'Proforma' : 'Invoice'} ${invoice.number.replaceAll('/', '-')}`} noun={proforma ? 'proforma' : 'invoice'}>
      <InvoiceDocument invoice={invoice} variant={kind} />
    </PrintShell>
  );
}

/** Several invoices in one go, one after another, each starting on a new page. */
export function PrintInvoicesPage({ ids }: { ids: string[] }) {
  const query = useQuery(() => Promise.all(ids.map((id) => api.invoiceGet(id))), [ids.join(',')]);
  const invoices = query.data;

  if (query.error) return <p className="p-8 text-status-overdue-fg">{query.error}</p>;
  if (!invoices) return null;
  return (
    <PrintShell ready title={`${invoices.length} invoices`} noun="set of invoices">
      {invoices.map((inv, i) => (
        <div key={inv.id} style={i > 0 ? { breakBefore: 'page' } : undefined}>
          <InvoiceDocument invoice={inv} />
        </div>
      ))}
    </PrintShell>
  );
}

/** The bare credit note, with no app chrome, for PDF export and printing. */
export function PrintCreditNotePage({ id }: { id: string }) {
  const query = useQuery(() => api.creditNoteGet(id), [id]);
  const note = query.data;
  if (query.error) return <p className="p-8 text-status-overdue-fg">{query.error}</p>;
  if (!note) return null;
  return (
    <PrintShell ready title={`Credit note ${note.number.replaceAll('/', '-')}`} noun="credit note">
      <CreditNoteDocument note={note} />
    </PrintShell>
  );
}
