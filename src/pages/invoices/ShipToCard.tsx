import { Truck } from 'lucide-react';
import { useState } from 'react';
import { STATE_NAMES } from '../../../shared/states';
import type { Customer, ShipTo } from '../../../shared/types';
import { Card, Field, Input, Select } from '../../components/ui';

export const EMPTY_SHIP_TO: ShipTo = { name: '', address: '', city: '', state: '', pincode: '', phone: '' };

/**
 * Optional delivery details when the goods go somewhere other than the billing address: one of the customer's saved addresses, or
 * a new one typed in, plus who carries it. Collapsed unless wanted, so a counter sale stays quick.
 */
export function ShipToCard({
  customer,
  shipTo,
  onShipTo,
  transport,
  onTransport,
  trackingNo,
  onTrackingNo,
}: {
  customer: Customer | null;
  shipTo: ShipTo | null;
  onShipTo: (s: ShipTo | null) => void;
  transport: string;
  onTransport: (v: string) => void;
  trackingNo: string;
  onTrackingNo: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const saved = customer?.addresses ?? [];
  const active = open || shipTo !== null || transport !== '';

  if (!active) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 text-sm text-brand transition-colors hover:text-brand-hover">
        <Truck className="h-4 w-4" aria-hidden /> Ship to another address, or add a transporter
      </button>
    );
  }

  const set = (patch: Partial<ShipTo>) => onShipTo({ ...(shipTo ?? EMPTY_SHIP_TO), ...patch });
  const pick = (value: string) => {
    if (value === 'billing') return onShipTo(null);
    if (value === 'new') return onShipTo({ ...EMPTY_SHIP_TO, name: customer?.name ?? '' });
    const a = saved[Number(value)];
    if (a) onShipTo({ name: customer?.name ?? '', address: a.address, city: a.city, state: a.state, pincode: a.pincode, phone: customer?.phone ?? '' });
  };
  const selected = shipTo === null ? 'billing' : String(saved.findIndex((a) => a.address === shipTo.address && a.city === shipTo.city)).replace('-1', 'new');

  return (
    <Card className="space-y-4 p-6">
      <h2 className="flex items-center gap-2 text-base">
        <Truck className="h-4 w-4 text-ink-muted" aria-hidden /> Delivery
      </h2>
      <Field label="Deliver to" hint="The ship-to address is printed on the invoice.">
        <Select value={selected} onChange={(e) => pick(e.target.value)}>
          <option value="billing">Same as the billing address</option>
          {saved.map((a, i) => (
            <option key={i} value={String(i)}>
              {a.label || 'Saved address'} — {[a.address, a.city].filter(Boolean).join(', ')}
            </option>
          ))}
          <option value="new">A different address…</option>
        </Select>
      </Field>
      {shipTo && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={shipTo.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={shipTo.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" />
          </Field>
          <Field label="Address" >
            <Input value={shipTo.address} onChange={(e) => set({ address: e.target.value })} />
          </Field>
          <Field label="City">
            <Input value={shipTo.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
          <Field label="State">
            <Select value={shipTo.state} onChange={(e) => set({ state: e.target.value })}>
              <option value="">Not set</option>
              {STATE_NAMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pincode">
            <Input value={shipTo.pincode} onChange={(e) => set({ pincode: e.target.value })} maxLength={6} inputMode="numeric" className="num" />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Transport / courier">
          <Input value={transport} onChange={(e) => onTransport(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Tracking / LR number">
          <Input value={trackingNo} onChange={(e) => onTrackingNo(e.target.value)} placeholder="Add later if not known" className="num" />
        </Field>
      </div>
    </Card>
  );
}
