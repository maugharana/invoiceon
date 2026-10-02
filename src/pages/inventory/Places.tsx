import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { type StockLocation, type Variant } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, IconButton, Input, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { formatDateTime } from '../../lib/format';
import { plural } from '../../lib/format';

/** The places sarees are kept: the shop, and any godown or showroom you add. */
export function PlacesModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const places = useQuery(() => api.locationsList());
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function attempt(work: () => Promise<unknown>, done: string) {
    setError(null);
    try {
      await work();
      refresh();
      toast.success(done);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal title="Where your sarees are kept" size="sm" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <p className="mb-4 text-ink-muted">Sarees are sold from the shop. Add a godown or showroom to keep stock elsewhere, and move pieces between places from a saree's page.</p>
      <ul className="mb-4 divide-y divide-line/70 rounded-lg border border-line">
        {(places.data ?? []).map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
            {renaming?.id === p.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void attempt(async () => {
                    await api.locationRename(p.id, renaming.name);
                    setRenaming(null);
                  }, 'Renamed');
                }}
              >
                <Input value={renaming.name} onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} data-autofocus />
                <Button type="submit">Save</Button>
              </form>
            ) : (
              <>
                <span>
                  {p.name}
                  <span className="ml-2 text-xs text-ink-muted">{plural(p.pieces, 'piece')}</span>
                  {p.isDefault && <span className="ml-2 text-xs text-brand">sold from here</span>}
                </span>
                {!p.isDefault && (
                  <span className="flex gap-0.5">
                    <IconButton label={`Rename ${p.name}`} onClick={() => setRenaming({ id: p.id, name: p.name })}>
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                    <IconButton label={`Remove ${p.name}`} onClick={() => void attempt(() => api.locationArchive(p.id), `${p.name} removed`)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void attempt(async () => {
            await api.locationCreate(name);
            setName('');
          }, 'Place added');
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New place, e.g. Godown" maxLength={40} aria-label="New place" />
        <Button type="submit" icon={<Plus className="h-4 w-4" />} disabled={!name.trim()}>
          Add
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}

/** Move some pieces of one saree to another place. */
export function TransferStockModal({ variant, places, onClose }: { variant: Variant; places: StockLocation[]; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const held = (id: string) => variant.locations.find((l) => l.locationId === id)?.qty ?? 0;
  const firstWithStock = places.find((p) => held(p.id) > 0) ?? places[0]!;
  const [from, setFrom] = useState(firstWithStock.id);
  const [to, setTo] = useState(places.find((p) => p.id !== firstWithStock.id)?.id ?? '');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const history = useQuery(() => api.stockTransfers(variant.id), [variant.id]);
  const n = Number(qty);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.stockTransfer({ variantId: variant.id, fromLocationId: from, toLocationId: to, qty: n, note });
      refresh();
      toast.success('Stock moved');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Move stock — ${variant.color} / ${variant.size}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!(n >= 1) || from === to || !to} onClick={() => void submit()}>
            Move
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-ink-muted">
          {variant.locations.map((l) => (
            <li key={l.locationId}>
              {l.name}: <span className="num text-ink">{l.qty}</span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From">
            <Select value={from} onChange={(e) => setFrom(e.target.value)}>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({held(p.id)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To">
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="How many pieces" hint={`Up to ${held(from)} from here`}>
          <Input value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="num max-w-[8rem] text-right" data-autofocus />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        {(history.data?.length ?? 0) > 0 && (
          <div>
            <div className="mb-1 text-xs text-ink-muted">Earlier moves</div>
            <ul className="divide-y divide-line/70 text-xs">
              {history.data!.slice(0, 4).map((t) => (
                <li key={t.id} className="flex justify-between py-1">
                  <span>
                    {t.qty} · {t.fromName} → {t.toName}
                  </span>
                  <span className="text-ink-muted">{formatDateTime(t.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
