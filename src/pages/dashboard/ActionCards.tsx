import { ClipboardCopy, ClipboardList, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { quoteReminder, reorderNote, whatsappLink, whatsappPhone } from '../../../shared/messages';
import type { DesignSummary, ProformaSummary } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Card, Money } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { navigate, paths } from '../../lib/router';

/** Designs running low, with one click to copy a ready-to-send reorder list. */
export function LowStockCard({ designs, businessName }: { designs: DesignSummary[]; businessName: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function copyReorderList() {
    setBusy(true);
    try {
      const note = reorderNote(await api.dashboardReorderList(), businessName, todayIso());
      if (await copyText(note)) toast.success('Reorder list copied — paste it into a message');
      else toast.error('Couldn’t copy to the clipboard');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-base">Low on stock</h2>
        <span className="flex items-center gap-2">
          {designs.length > 0 && (
            <Button className="h-8 px-2.5 text-xs" icon={<ClipboardCopy className="h-3.5 w-3.5" />} loading={busy} onClick={() => void copyReorderList()} title="Copy a list of what to reorder, to paste into a message">
              Copy reorder list
            </Button>
          )}
          <a href={`#${paths.inventory('low')}`} className="text-brand transition-colors hover:text-brand-hover">
            View
          </a>
        </span>
      </div>
      {designs.length === 0 ? (
        <p className="px-5 py-6 text-ink-muted">Everything is well stocked.</p>
      ) : (
        <ul>
          {designs.slice(0, 4).map((d) => (
            <li key={d.id} className="border-b border-line/70 last:border-0">
              <button type="button" onClick={() => navigate(paths.design(d.id))} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-canvas">
                <span className="min-w-0 truncate">{d.name}</span>
                <span className={`num shrink-0 text-xs ${d.status === 'out' ? 'text-status-overdue-fg' : 'text-status-partial-fg'}`}>{d.status === 'out' ? 'Out of stock' : `${d.totalStock} left`}</span>
              </button>
            </li>
          ))}
          {designs.length > 4 && <li className="px-5 py-2.5 text-xs text-ink-muted">and {designs.length - 4} more</li>}
        </ul>
      )}
    </Card>
  );
}

/** Quotes waiting for an answer, each with a one-click reminder: it opens WhatsApp when the customer has a number, and always copies the message. */
export function OpenQuotesCard({ quotes, businessName, onNew }: { quotes: ProformaSummary[]; businessName: string; onNew: () => void }) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remind(q: ProformaSummary) {
    setBusyId(q.id);
    try {
      const text = quoteReminder(q, businessName);
      const copied = await copyText(text);
      const phone = q.customerId ? whatsappPhone((await api.customerGet(q.customerId)).phone) : null;
      if (phone) {
        window.open(whatsappLink(phone, text), '_blank');
        toast.success(`Reminder for ${q.number} opened in WhatsApp${copied ? ' (and copied)' : ''}`);
      } else if (copied) {
        toast.success(q.customerId ? `Reminder for ${q.number} copied — add ${q.buyerName}'s phone number to open WhatsApp next time` : `Reminder for ${q.number} copied — paste it into a message`);
      } else {
        toast.error('Couldn’t copy the reminder to the clipboard');
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="overflow-hidden shadow-card">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-base">Open quotes</h2>
        <a href={`#${paths.proformas('open')}`} className="text-brand transition-colors hover:text-brand-hover">
          View
        </a>
      </div>
      {quotes.length === 0 ? (
        <div className="flex items-center justify-between gap-3 px-5 py-6 text-ink-muted">
          <span>No quotes waiting.</span>
          <Button className="h-8 text-xs" icon={<ClipboardList className="h-3.5 w-3.5" />} onClick={onNew}>
            New proforma
          </Button>
        </div>
      ) : (
        <ul>
          {quotes.slice(0, 4).map((p) => (
            <li key={p.id} className="flex items-center gap-2 border-b border-line/70 pr-3 last:border-0">
              <button type="button" onClick={() => navigate(paths.proforma(p.id))} className="flex min-w-0 flex-1 items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-canvas">
                <span className="min-w-0">
                  <span className="block truncate">{p.buyerName}</span>
                  <span className="num block text-xs text-ink-muted">
                    {p.number} · until {formatDate(p.validUntil)}
                  </span>
                </span>
                <Money paise={p.totalPaise} fractionDigits={0} className="shrink-0" />
              </button>
              <Button className="h-8 px-2.5 text-xs" icon={<MessageCircle className="h-3.5 w-3.5" />} loading={busyId === p.id} onClick={() => void remind(p)} title={`Remind ${p.buyerName} about ${p.number}`}>
                Remind
              </Button>
            </li>
          ))}
          {quotes.length > 4 && <li className="px-5 py-2.5 text-xs text-ink-muted">and {quotes.length - 4} more</li>}
        </ul>
      )}
    </Card>
  );
}
