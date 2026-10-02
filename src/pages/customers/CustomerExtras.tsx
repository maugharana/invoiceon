import { Gift, Heart, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import type { Customer } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Input, Pill, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';

/** Loyalty points: the balance, what each point is worth, and the history. Shown only when the shop has switched loyalty on. */
export function LoyaltyCard({ customer }: { customer: Customer }) {
  const settings = useQuery(() => api.getSettings());
  const history = useQuery(() => api.loyaltyHistory(customer.id), [customer.id, customer.loyaltyPoints]);
  const [adjusting, setAdjusting] = useState(false);
  const s = settings.data;
  if (!s || (s.loyaltySpendPaise <= 0 && customer.loyaltyPoints === 0 && (history.data?.length ?? 0) === 0)) return null;
  const worth = customer.loyaltyPoints * s.loyaltyPointValuePaise;

  return (
    <Card className="mb-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base">
            <Gift className="h-4 w-4 text-ink-muted" aria-hidden /> Loyalty points
          </h2>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="num text-2xl">{customer.loyaltyPoints}</span>
            <span className="text-ink-muted">worth {formatMoney(worth, { fractionDigits: 0 })} off a bill</span>
          </div>
          {s.loyaltySpendPaise > 0 && <p className="mt-1 text-xs text-ink-muted">Earns 1 point for every {formatMoney(s.loyaltySpendPaise, { fractionDigits: 0 })} billed. Choose “Use points” on a new invoice to spend them.</p>}
        </div>
        <Button onClick={() => setAdjusting(true)}>Add or remove points</Button>
      </div>
      {history.data && history.data.length > 0 && (
        <ul className="mt-4 max-h-48 divide-y divide-line/70 overflow-y-auto">
          {history.data.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-1.5">
              <span>
                <span className="num text-ink-muted">{formatDate(h.createdAt.slice(0, 10))}</span>
                <span className="ml-3">{h.note || h.reason}</span>
              </span>
              <span className={`num ${h.points < 0 ? 'text-ink-muted' : ''}`}>{h.points > 0 ? '+' : '−'}{Math.abs(h.points)}</span>
            </li>
          ))}
        </ul>
      )}
      {adjusting && <AdjustPoints customer={customer} onClose={() => setAdjusting(false)} />}
    </Card>
  );
}

function AdjustPoints({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const balance = await api.loyaltyAdjust({ customerId: customer.id, points: Number(points), note });
      refresh();
      toast.success(`${customer.name} now has ${balance} points`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }
  return (
    <Modal
      title={`Points for ${customer.name}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!Number(points) || !note.trim()} loading={saving} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Points to add" hint="Use a minus sign to take points off, e.g. -20.">
          <Input value={points} onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ''))} inputMode="numeric" className="num text-right" data-autofocus />
        </Field>
        <Field label="Why">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. birthday gift, correction" maxLength={120} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

/** Designs this customer has asked for. When one is in stock the notifications say so, and buying it clears it from the list. */
export function WishlistCard({ customer }: { customer: Customer }) {
  const toast = useToast();
  const refresh = useRefresh();
  const wishes = useQuery(() => api.wishlistGet(customer.id), [customer.id]);
  const designs = useQuery(() => api.designsList());
  const [designId, setDesignId] = useState('');
  const [note, setNote] = useState('');
  const taken = new Set((wishes.data ?? []).map((w) => w.designId));

  async function add() {
    try {
      await api.wishlistAdd({ customerId: customer.id, designId, note });
      setDesignId('');
      setNote('');
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card className="mb-6 p-6">
      <h2 className="flex items-center gap-2 text-base">
        <Heart className="h-4 w-4 text-ink-muted" aria-hidden /> Wishlist
      </h2>
      <p className="mt-0.5 text-xs text-ink-muted">Sarees {customer.name} has asked for. You'll be reminded when one is in stock.</p>
      {wishes.data && wishes.data.length > 0 && (
        <ul className="mt-3 divide-y divide-line/70">
          {wishes.data.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <a href={`#/inventory/designs/${w.designId}`} className="transition-colors hover:text-brand">{w.designName}</a>
                {w.note && <span className="ml-2 text-ink-muted">{w.note}</span>}
              </span>
              <span className="flex items-center gap-3">
                {w.inStock && <Pill tone="paid">In stock</Pill>}
                <button
                  type="button"
                  aria-label={`Remove ${w.designName} from the wishlist`}
                  onClick={async () => {
                    await api.wishlistRemove(w.id);
                    refresh();
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
        <Select value={designId} onChange={(e) => setDesignId(e.target.value)} aria-label="Design they want">
          <option value="">Add a design…</option>
          {(designs.data ?? []).filter((d) => !taken.has(d.id)).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Colour or note (optional)" maxLength={120} aria-label="Note" />
        <Button icon={<Plus className="h-4 w-4" />} disabled={!designId} onClick={() => void add()}>
          Add
        </Button>
      </div>
    </Card>
  );
}
