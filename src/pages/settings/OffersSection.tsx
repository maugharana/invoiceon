import { Gift, Plus, Tag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDate, todayIso } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import { describeOffer, isOfferLive, type LoyaltyConfig, type Offer, type OfferInput, type OfferKind } from '../../../shared/offers';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, MoneyInput, Pill, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';

const money = (p: number) => formatMoney(p, { fractionDigits: 0 });

/** Offers (named discounts with rules) and the loyalty points scheme. Both are optional and add to the discount typed on an invoice. */
export function OffersSection() {
  return (
    <div className="space-y-10">
      <Loyalty />
      <Offers />
    </div>
  );
}

function Loyalty() {
  const toast = useToast();
  const refresh = useRefresh();
  const saved = useQuery(() => api.loyaltyConfig());
  const [cfg, setCfg] = useState<LoyaltyConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (saved.data && !cfg) setCfg(saved.data);
  }, [saved.data, cfg]);
  if (!cfg) return saved.error ? <ErrorNote>{saved.error}</ErrorNote> : <Spinner />;
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved.data);
  const set = <K extends keyof LoyaltyConfig>(k: K, v: LoyaltyConfig[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setCfg(await api.loyaltySave(cfg!));
      refresh();
      toast.success('Loyalty settings saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3 className="flex items-center gap-2 text-base">
        <Gift className="h-4 w-4 text-brand" aria-hidden /> Loyalty points
      </h3>
      <p className="mb-4 mt-1 text-ink-muted">Customers earn points on every purchase and can spend them as a discount on the next. Points belong to saved customers, not walk-in sales.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <label className="mb-4 flex items-center gap-2">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Give loyalty points
      </label>
      <div className="grid max-w-xl grid-cols-3 gap-4">
        <Field label="Points for every ₹100" hint="On the value before GST, after any discount.">
          <Input type="number" min={1} max={100} className="num" value={cfg.pointsPer100} onChange={(e) => set('pointsPer100', Math.trunc(Number(e.target.value) || 0))} />
        </Field>
        <Field label="One point is worth" hint="When spent as a discount.">
          <MoneyInput value={cfg.paisePerPoint} onChange={(p) => set('paisePerPoint', p)} />
        </Field>
        <Field label="Spend at least" hint="Points at a time.">
          <Input type="number" min={0} className="num" value={cfg.minRedeem} onChange={(e) => set('minRedeem', Math.trunc(Number(e.target.value) || 0))} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        {cfg.enabled ? `A ${money(1_000_00)} purchase earns ${Math.floor((1_000_00 * cfg.pointsPer100) / 100 / 100)} points, worth ${money(Math.floor((1_000_00 * cfg.pointsPer100) / 100 / 100) * cfg.paisePerPoint)} on the next bill.` : 'Switched off: nobody earns points, and existing points cannot be spent.'}
      </p>
      <Button className="mt-4" variant="primary" loading={busy} disabled={!dirty} onClick={() => void save()}>
        Save loyalty settings
      </Button>
    </section>
  );
}

function Offers() {
  const offers = useQuery(() => api.offersList());
  const [editing, setEditing] = useState<Offer | 'new' | null>(null);
  const today = todayIso();

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base">
            <Tag className="h-4 w-4 text-brand" aria-hidden /> Offers
          </h3>
          <p className="mt-1 text-ink-muted">A festival sale, a discount on one design, money off a big bill. Choose an offer on the New invoice screen and it is taken off for you.</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          New offer
        </Button>
      </div>
      {offers.error && <ErrorNote>{offers.error}</ErrorNote>}
      {offers.data?.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-ink-muted">No offers yet.</p>
      ) : (
        <ul className="divide-y divide-line/70 rounded-lg border border-line">
          {offers.data?.map((o) => (
            <li key={o.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{o.name}</div>
                <div className="text-xs text-ink-muted">
                  {describeOffer(o, money)} · {formatDate(o.startDate)} to {o.endDate ? formatDate(o.endDate) : 'no end date'}
                </div>
              </div>
              {isOfferLive(o, today) ? <Pill tone="paid">Running</Pill> : <Pill tone="neutral">{!o.active ? 'Switched off' : o.startDate > today ? 'Not started' : 'Ended'}</Pill>}
              <Button onClick={() => setEditing(o)}>Edit</Button>
            </li>
          ))}
        </ul>
      )}
      {editing && <OfferDialog offer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function OfferDialog({ offer, onClose }: { offer: Offer | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const designs = useQuery(() => api.designsList({}));
  const [form, setForm] = useState<OfferInput>(
    offer
      ? { name: offer.name, kind: offer.kind, value: offer.value, minBillPaise: offer.minBillPaise, designId: offer.designId, startDate: offer.startDate, endDate: offer.endDate, active: offer.active }
      : { name: '', kind: 'percent', value: 10, minBillPaise: 0, designId: null, startDate: todayIso(), endDate: null, active: true },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof OfferInput>(k: K, v: OfferInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.offerSave(offer?.id ?? null, form);
      refresh();
      toast.success(offer ? 'Offer saved' : 'Offer created');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function archive() {
    if (!offer) return;
    setBusy(true);
    try {
      await api.offerArchive(offer.id);
      refresh();
      toast.success('Offer removed. Invoices that used it keep its name.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={offer ? 'Edit offer' : 'New offer'}
      onClose={onClose}
      footer={
        <>
          {offer && (
            <Button variant="danger" className="mr-auto" disabled={busy} onClick={() => void archive()}>
              Remove
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!form.name.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Name" hint="Printed on the invoice.">
          <Input autoFocus value={form.name} maxLength={60} onChange={(e) => set('name', e.target.value)} placeholder="Diwali 10% off" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Takes off">
            <Select value={form.kind} onChange={(e) => set('kind', e.target.value as OfferKind)}>
              <option value="percent">A percentage</option>
              <option value="flat">A flat amount</option>
            </Select>
          </Field>
          <Field label={form.kind === 'percent' ? 'Percent' : 'Amount'}>
            {form.kind === 'percent' ? <Input type="number" min={0} max={100} step="0.5" className="num" value={form.value} onChange={(e) => set('value', Number(e.target.value))} /> : <MoneyInput value={Math.round(form.value)} onChange={(p) => set('value', p)} />}
          </Field>
        </div>
        <Field label="Applies to">
          <Select value={form.designId ?? ''} onChange={(e) => set('designId', e.target.value || null)}>
            <option value="">The whole bill</option>
            {designs.data?.map((d) => (
              <option key={d.id} value={d.id}>
                Only {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Only on bills of at least" hint="Leave at 0 for no minimum.">
          <MoneyInput value={form.minBillPaise} onChange={(p) => set('minBillPaise', p)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="First day">
            <Input type="date" className="num" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field label="Last day" hint="Empty: no end date.">
            <Input type="date" className="num" value={form.endDate ?? ''} min={form.startDate} onChange={(e) => set('endDate', e.target.value || null)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Switched on
        </label>
      </form>
    </Modal>
  );
}
