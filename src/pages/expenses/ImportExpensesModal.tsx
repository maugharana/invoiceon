import { formatMoney } from '../../../shared/money';
import { parseExpenseRows } from '../../../shared/importRows';
import { PAYMENT_METHOD_LABEL } from '../../../shared/types';
import { SheetImportModal } from '../../components/SheetImportModal';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';

export function ImportExpensesModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  return (
    <SheetImportModal
      title="Add expenses from a sheet"
      noun="expense"
      hint={
        <>
          Headings in the first row: <span className="text-ink">Date, Category, Paid to, Paid by, Amount, Reference, Note</span> (any order). Dates like 30/09/2026 or 2026-09-30; “Paid by” can be cash, UPI, bank transfer, cheque or card (blank means cash). Without headings the columns are read in that order.
        </>
      }
      example={'Date\tCategory\tPaid to\tPaid by\tAmount\n30/09/2026\tRent\tLandlord\tBank transfer\t12000\n01/10/2026\tTea\t\tCash\t45'}
      parse={parseExpenseRows}
      columns={[
        { heading: 'Date', cell: (e) => e.date },
        { heading: 'Category', cell: (e) => e.category },
        { heading: 'Paid to', cell: (e) => e.vendor },
        { heading: 'Paid by', cell: (e) => PAYMENT_METHOD_LABEL[e.method] },
        { heading: 'Amount', right: true, cell: (e) => formatMoney(e.amountPaise) },
      ]}
      onImport={async (rows) => {
        const n = await api.expensesBulkAdd(rows);
        refresh();
        const message = `${plural(n, 'expense')} added`;
        toast.success(message);
        return message;
      }}
      onClose={onClose}
    />
  );
}
