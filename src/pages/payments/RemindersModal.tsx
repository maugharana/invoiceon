import { ClipboardCopy, MessageCircle } from 'lucide-react';
import { dueReminder, whatsappLink, whatsappPhone } from '../../../shared/messages';
import type { DuesRow } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Money } from '../../components/ui';
import { api } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';

const overdueOf = (r: DuesRow) => r.days1to30Paise + r.days31to60Paise + r.days61plusPaise;

/** Everyone with money overdue, each with a ready-written reminder: open it in WhatsApp (when there's a number) or copy it. */
export function RemindersModal({ rows, businessName, upiId, template = '', onClose }: { rows: DuesRow[]; businessName: string; upiId: string; template?: string; onClose: () => void }) {
  const toast = useToast();
  const customers = useQuery(() => api.customersList());
  const phones = new Map((customers.data ?? []).map((c) => [c.id, c.phone]));
  const overdue = rows.filter((r) => r.customerId && overdueOf(r) > 0).sort((a, b) => overdueOf(b) - overdueOf(a));
  const messageFor = (r: DuesRow) => dueReminder({ customerName: r.customerName, owedPaise: r.outstandingPaise, overduePaise: overdueOf(r), openInvoices: r.openInvoices, oldestDueDate: r.oldestDueDate }, { name: businessName, upiId }, template);

  async function copyOne(r: DuesRow) {
    if (await copyText(messageFor(r))) toast.success(`Reminder for ${r.customerName} copied`);
    else toast.error('Couldn’t copy to the clipboard');
  }
  function whatsApp(r: DuesRow) {
    const phone = whatsappPhone(phones.get(r.customerId ?? '') ?? '');
    if (phone) window.open(whatsappLink(phone, messageFor(r)), '_blank');
  }
  async function copyAll() {
    const text = overdue.map((r) => `${r.customerName}${phones.get(r.customerId ?? '') ? ` (${phones.get(r.customerId ?? '')})` : ''}\n${messageFor(r)}`).join('\n\n———\n\n');
    if (await copyText(text)) toast.success(`${plural(overdue.length, 'reminder')} copied`);
    else toast.error('Couldn’t copy to the clipboard');
  }

  return (
    <Modal
      title="Remind customers who are overdue"
      size="lg"
      onClose={onClose}
      footer={
        <>
          {overdue.length > 1 && (
            <Button className="mr-auto" icon={<ClipboardCopy className="h-4 w-4" />} onClick={() => void copyAll()}>
              Copy all {overdue.length} messages
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {overdue.length === 0 ? (
        <p className="text-ink-muted">Nobody is overdue right now.</p>
      ) : (
        <>
          <p className="mb-3 text-ink-muted">Largest overdue amount first. WhatsApp opens with the message ready; you press send.</p>
          <ul className="divide-y divide-line/70 rounded-lg border border-line">
            {overdue.map((r) => {
              const phone = whatsappPhone(phones.get(r.customerId ?? '') ?? '');
              return (
                <li key={r.customerId} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{r.customerName}</div>
                    <div className="text-xs text-ink-muted">
                      <Money paise={overdueOf(r)} fractionDigits={0} /> overdue of <Money paise={r.outstandingPaise} fractionDigits={0} /> · {plural(r.openInvoices, 'invoice')}
                      {!phone && customers.data && ' · no phone number'}
                    </div>
                  </div>
                  <Button className="h-8 px-2.5 text-xs" icon={<ClipboardCopy className="h-3.5 w-3.5" />} onClick={() => void copyOne(r)}>
                    Copy
                  </Button>
                  <Button className="h-8 px-2.5 text-xs" icon={<MessageCircle className="h-3.5 w-3.5" />} disabled={!phone} onClick={() => whatsApp(r)} title={phone ? undefined : 'Add a phone number to this customer first'}>
                    WhatsApp
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modal>
  );
}
