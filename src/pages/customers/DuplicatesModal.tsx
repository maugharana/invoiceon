import { useState } from 'react';
import { findDuplicateGroups, type DuplicateGroup } from '../../../shared/customerList';
import type { Customer } from '../../../shared/types';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Money, TypePill } from '../../components/ui';
import { api } from '../../lib/api';
import { useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';

/** Customers that look like the same person (same phone or GSTIN), each group with a way to fold the others into the one you choose. */
export function DuplicatesModal({ customers, onClose }: { customers: Customer[]; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [pending, setPending] = useState<{ keep: Customer; others: Customer[] } | null>(null);
  const groups = findDuplicateGroups(customers);

  const why = (g: DuplicateGroup) => (g.reason === 'phone' ? `Same phone number (${g.value})` : `Same GSTIN (${g.value})`);

  return (
    <>
      <Modal title="Possible duplicate customers" size="lg" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
        {groups.length === 0 ? (
          <p className="text-ink-muted">No duplicates found. Customers with the same phone number or GSTIN would show up here.</p>
        ) : (
          <div className="space-y-5">
            <p className="text-ink-muted">Pick the customer to keep. Their invoices, payments and quotes all move onto that one, and the others are archived. Invoices already issued keep the name they were printed with.</p>
            {groups.map((g) => (
              <section key={`${g.reason}:${g.value}`} className="rounded-lg border border-line">
                <h3 className="border-b border-line bg-canvas px-4 py-2 text-xs text-ink-muted">{why(g)}</h3>
                <ul className="divide-y divide-line/70">
                  {g.customers.map((c) => (
                    <li key={c.id} className="flex items-center gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <a href={`#/customers/${encodeURIComponent(c.id)}`} onClick={onClose} className="truncate transition-colors hover:text-brand">
                            {c.name}
                          </a>
                          <TypePill type={c.type} />
                        </div>
                        <div className="text-xs text-ink-muted">
                          {[c.phone, c.city].filter(Boolean).join(' · ') || 'No contact details'} · {plural(c.invoiceCount, 'invoice')}
                          {c.outstandingPaise > 0 && (
                            <>
                              {' '}
                              · owes <Money paise={c.outstandingPaise} fractionDigits={0} />
                            </>
                          )}
                        </div>
                      </div>
                      <Button className="h-8 text-xs" onClick={() => setPending({ keep: c, others: g.customers.filter((o) => o.id !== c.id) })}>
                        Keep this one
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Modal>
      {pending && (
        <ConfirmDialog
          title={`Keep ${pending.keep.name}?`}
          confirmLabel="Merge customers"
          danger
          onClose={() => setPending(null)}
          body={
            <p>
              {pending.others.map((o) => o.name).join(', ')} will be merged into {pending.keep.name}: their invoices, payments and quotes move across and they are archived. This can't be undone.
            </p>
          }
          onConfirm={async () => {
            for (const other of pending.others) await api.customerMerge(pending.keep.id, other.id);
            refresh();
            toast.success(`Merged into ${pending.keep.name}`);
          }}
        />
      )}
    </>
  );
}
