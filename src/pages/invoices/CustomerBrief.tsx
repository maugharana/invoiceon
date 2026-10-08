import { Cake, Check, Gift, Heart, NotebookPen, PhoneCall, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { addDays, formatDate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { upcomingOccasions } from '../../../shared/occasions';
import type { Customer } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Input, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { Chip } from './invoiceParts';

/** When to be reminded, as a pick: a note with a day is a follow-up that shows up on the dashboard when it is due. */
const REMIND = [
  { value: '', label: 'No reminder' },
  { value: '1', label: 'Tomorrow' },
  { value: '3', label: 'In 3 days' },
  { value: '7', label: 'In a week' },
  { value: '14', label: 'In 2 weeks' },
  { value: '30', label: 'In a month' },
];

/**
 * What is worth knowing about the customer while their bill is being made: promises and follow-ups that are open, a birthday or
 * anniversary coming up, what they owe or hold, what they usually buy, and what they have asked for. Only what exists is shown, and a
 * note can be added on the spot. It never stops the bill; it is there so nothing said last time is forgotten.
 */
export function CustomerBrief({ customer, onWant }: { customer: Customer; /** Picks a design the customer asked for, in the item picker. */ onWant: (designId: string) => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const taste = useQuery(() => api.customerTaste(customer.id), [customer.id]);
  const open = useQuery(() => api.notesDue({}), []);
  const wishes = useQuery(() => api.wishlistGet(customer.id), [customer.id]);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [remind, setRemind] = useState('');
  const [busy, setBusy] = useState(false);

  const today = todayIso();
  const mine = (open.data ?? []).filter((n) => n.customerId === customer.id);
  const occasions = upcomingOccasions(customer, today, 14);
  const t = taste.data;
  const wanted = (wishes.data ?? []).filter((w) => w.inStock);
  const waiting = (wishes.data ?? []).filter((w) => !w.inStock);
  const tags = (customer.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const name = customer.name.split(' ')[0];

  async function done(id: string) {
    try {
      await api.noteDone(id, true);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function addNote() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.noteAdd({ subjectType: 'customer', subjectId: customer.id, kind: remind ? 'followup' : 'note', body: text.trim(), dueDate: remind ? addDays(today, Number(remind)) : null });
      toast.success(remind ? `Noted — you will be reminded ${REMIND.find((r) => r.value === remind)!.label.toLowerCase()}` : 'Noted');
      setText('');
      setRemind('');
      setAdding(false);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const money: string[] = [];
  if (customer.outstandingPaise > 0) money.push(`owes ${formatMoney(customer.outstandingPaise, { fractionDigits: 0 })}`);
  if (customer.advancePaise > 0) money.push(`holds ${formatMoney(customer.advancePaise, { fractionDigits: 0 })} advance`);
  if (customer.loyaltyPoints > 0) money.push(`${plural(customer.loyaltyPoints, 'loyalty point')}`);

  const likes = t && t.pieces > 0 ? [t.colors.slice(0, 3).map((c) => c.name).join(', '), t.sizes[0]?.name].filter(Boolean).join(' · ') : '';
  const hasHeadsUp = mine.length > 0 || occasions.length > 0;
  const hasAbout = !!customer.notes.trim() || tags.length > 0 || money.length > 0 || (t && t.pieces > 0) || wanted.length > 0 || waiting.length > 0;

  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-canvas/60 p-4">
      {hasHeadsUp && (
        <ul className="space-y-1.5">
          {mine.map((n) => {
            const late = !!n.dueDate && n.dueDate < today;
            return (
              <li key={n.id} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm ${late ? 'bg-status-overdue-bg text-status-overdue-fg' : 'bg-status-partial-bg text-status-partial-fg'}`}>
                <PhoneCall className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{n.kind === 'promise' ? `Promised ${n.amountPaise > 0 ? formatMoney(n.amountPaise, { fractionDigits: 0 }) : 'to pay'}` : 'Follow-up'}</span>
                  {n.dueDate && <span> · {late ? 'was due' : 'due'} {formatDate(n.dueDate)}</span>}
                  {n.subjectLabel && <span> · {n.subjectLabel}</span>}
                  {n.body && <span className="block opacity-90">{n.body}</span>}
                </span>
                <button type="button" onClick={() => void done(n.id)} aria-label="Mark this as done" title="Mark as done" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/50">
                  <Check className="h-4 w-4" />
                </button>
              </li>
            );
          })}
          {occasions.map((o) => (
            <li key={o.kind} className="flex items-center gap-2.5 rounded-lg bg-brand-tint px-3 py-2 text-sm text-brand">
              {o.kind === 'birthday' ? <Cake className="h-4 w-4 shrink-0" aria-hidden /> : <Gift className="h-4 w-4 shrink-0" aria-hidden />}
              <span>
                {o.kind === 'birthday' ? 'Birthday' : 'Anniversary'} {o.daysAway === 0 ? 'today' : o.daysAway === 1 ? 'tomorrow' : `in ${o.daysAway} days`} — a good moment to wish {name}.
              </span>
            </li>
          ))}
        </ul>
      )}

      {hasAbout && (
        <div className="space-y-1.5 text-sm">
          {customer.notes.trim() && (
            <p className="flex items-start gap-2 text-ink">
              <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0">{customer.notes.trim()}</span>
            </p>
          )}
          {t && t.pieces > 0 && (
            <p className="flex items-start gap-2 text-ink-muted">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {name} usually takes <span className="text-ink">{likes}</span>, around <span className="num text-ink">{formatMoney(t.averagePiecePaise, { fractionDigits: 0 })}</span> a piece · {plural(t.pieces, 'piece')} on {plural(t.invoiceCount, 'bill')}
                {t.lastBoughtOn && <>, last on {formatDate(t.lastBoughtOn)}</>}.
              </span>
            </p>
          )}
          {(money.length > 0 || tags.length > 0) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
              {money.length > 0 && <span>{name} {money.join(' · ')}</span>}
              {tags.map((tag) => (
                <span key={tag} className="rounded-full bg-surface px-2 py-0.5">
                  {tag}
                </span>
              ))}
            </p>
          )}
          {(wanted.length > 0 || waiting.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
              <Heart className="h-4 w-4 text-ink-muted" aria-hidden />
              <span className="text-ink-muted">{name} asked for</span>
              {wanted.map((w) => (
                <Chip key={w.id} onClick={() => onWant(w.designId)} title={`${w.note || 'On the wishlist'} — in stock now: pick it below`}>
                  {w.designName} <span className="text-status-paid-fg">· in stock now</span>
                </Chip>
              ))}
              {waiting.map((w) => (
                <span key={w.id} className="rounded-full border border-dashed border-line px-3 py-1 text-ink-muted" title={w.note || 'Not in stock yet'}>
                  {w.designName} · not in stock
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {adding ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="min-w-[14rem] flex-1">
            <Input value={text} autoFocus onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={`e.g. ${name} wants a green Banarasi for the wedding`} aria-label={`A note about ${customer.name}`} onKeyDown={(e) => e.key === 'Enter' && void addNote()} />
          </div>
          <div className="w-40">
            <Select value={remind} onChange={(e) => setRemind(e.target.value)} aria-label="Remind me">
              {REMIND.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void addNote()}>
            Save note
          </Button>
          <Button onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-xs text-brand transition-colors hover:text-brand-hover">
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add a note about {name}
        </button>
      )}
    </div>
  );
}
