import { parseCustomerRows } from '../../../shared/importRows';
import { SheetImportModal } from '../../components/SheetImportModal';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';

export function ImportCustomersModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  return (
    <SheetImportModal
      title="Import customers from a sheet"
      noun="customer"
      hint={
        <>
          Headings in the first row: <span className="text-ink">Name, Phone, Email, GSTIN, Address, City, State, Pincode, Notes</span> (any order; only Name is needed). A customer with a GSTIN is added as a business. Anyone already on file with the same phone number or GSTIN is skipped.
        </>
      }
      example={'Name\tPhone\tGSTIN\tCity\nSunita Devi\t9876543210\t\tMau\nKanchan Sarees\t9000000001\t09AABCK1234M1ZI\tVaranasi'}
      parse={parseCustomerRows}
      columns={[
        { heading: 'Name', cell: (c) => c.name },
        { heading: 'Type', cell: (c) => c.type },
        { heading: 'Phone', cell: (c) => c.phone },
        { heading: 'GSTIN', cell: (c) => c.gstin },
        { heading: 'City', cell: (c) => c.city },
      ]}
      onImport={async (rows) => {
        const r = await api.customersImport(rows);
        refresh();
        const message = `${plural(r.created, 'customer')} added${r.skipped.length ? `, ${r.skipped.length} already on file and skipped` : ''}`;
        toast.success(message);
        return message;
      }}
      onClose={onClose}
    />
  );
}
