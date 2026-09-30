import { ArrowRightLeft, MapPin, Plus, Warehouse } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SHOP_LABEL, type HoldingRow, type Location } from '../../../shared/locations';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, Input, Money, Select, TableSkeleton } from '../../components/ui';
import { useAccess } from '../../lib/access';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { formatDateTime, plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { InventoryShell } from './InventoryTabs';

/**
 * Stock kept away from the shop: a godown, an exhibition stall. The shop's shelves are what you can sell; pieces moved to a place are
 * still counted as yours (in values and in what to reorder) and can be brought back. Every move is written into the stock history.
 */
export function LocationsPage() {
  const toast = useToast();
  const refresh = useRefresh();
  const { can } = useAccess();
  const places = useQuery(() => api.locationsList());
  const holdings = useQuery(() => api.stockHoldings());
  const moves = useQuery(() => api.transfersList(15));
  const [editing, setEditing] = useState<Location | 'new' | null>(null);
  const [closing, setClosing] = useState<Location | null>(null);
  const [moving, setMoving] = useState<{ variantId?: string } | null>(null);
  const editable = can('stock');
  const showCost = can('reports');
  const list = places.data ?? [];

  return (
    <InventoryShell
      tab="locations"
      actions={
        editable && (
          <>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add a place
            </Button>
            <Button variant="primary" icon={<ArrowRightLeft className="h-4 w-4" />} disabled={list.length === 0} onClick={() => setMoving({})}>
              Move stock
            </Button>
          </>
        )
      }
    >
      {places.error && <ErrorNote>{places.error}</ErrorNote>}
      {list.length === 0 && !places.loading ? (
        <Card>
          <EmptyState
            icon={<Warehouse className="h-6 w-6" />}
            title="Everything is in the shop"
            body="Add a godown, an exhibition stall or any other place you keep sarees. Move pieces there and back, and they stay counted as yours while they are away."
            actions={
              editable ? (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                  Add a place
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-3 gap-4">
            {list.map((l) => (
              <Card key={l.id} className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-brand" aria-hidden />
                    <h3 className="text-base">{l.name}</h3>
                  </div>
                  {editable && (
                    <div className="flex gap-2 text-xs">
                      <button type="button" className="text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setEditing(l)}>
                        Rename
                      </button>
                      <button type="button" className="text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setClosing(l)}>
                        Close
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-3 text-2xl tracking-tight">{plural(l.pieces, 'piece')}</div>
                <div className="text-xs text-ink-muted">
                  {plural(l.variants, 'saree')}
                  {showCost && l.valueAtCostPaise > 0 && <> · <Money paise={l.valueAtCostPaise} fractionDigits={0} /> at cost</>}
                </div>
              </Card>
            ))}
          </div>

          <h2 className="mb-3 text-base">Where everything is</h2>
          <Card className="mb-8 overflow-x-auto">
            {holdings.loading ? (
              <TableSkeleton columns={4} />
            ) : (holdings.data?.length ?? 0) === 0 ? (
              <p className="p-6 text-ink-muted">No stock anywhere yet.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Saree</th>
                    <th className="th text-right">{SHOP_LABEL}</th>
                    {list.map((l) => (
                      <th key={l.id} className="th text-right">
                        {l.name}
                      </th>
                    ))}
                    <th className="th text-right">Total</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {holdings.data?.map((h) => (
                    <tr key={h.variantId} className="border-b border-line/70 last:border-0">
                      <td className="td">
                        <button type="button" className="text-left hover:text-brand" onClick={() => navigate(paths.design(h.designId))}>
                          {h.designName}
                        </button>
                        <div className="text-xs text-ink-muted">
                          {h.color} · {h.size} · {h.sku}
                        </div>
                      </td>
                      <td className="td num text-right">{h.shop || <span className="text-ink-muted/50">—</span>}</td>
                      {list.map((l) => (
                        <td key={l.id} className="td num text-right">
                          {h.elsewhere[l.id] || <span className="text-ink-muted/50">—</span>}
                        </td>
                      ))}
                      <td className="td num text-right font-medium">{h.total}</td>
                      <td className="td text-right">
                        {editable && (
                          <Button className="h-8 px-2.5 text-xs" onClick={() => setMoving({ variantId: h.variantId })}>
                            Move
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {(moves.data?.length ?? 0) > 0 && (
            <>
              <h2 className="mb-3 text-base">Recent moves</h2>
              <Card>
                <ul className="divide-y divide-line/70 text-sm">
                  {moves.data?.map((m) => (
                    <li key={m.id} className="flex items-center gap-4 px-5 py-2.5">
                      <span className="num w-10 text-right font-medium">{m.qty}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {m.designName} <span className="text-ink-muted">({m.color}, {m.size})</span>: {m.fromName} to {m.toName}
                        {m.note && <span className="text-ink-muted"> · {m.note}</span>}
                      </span>
                      <span className="text-xs text-ink-muted">{formatDateTime(m.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )}
        </>
      )}

      {editing && <PlaceDialog place={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {moving && <MoveDialog places={list} holdings={holdings.data ?? []} variantId={moving.variantId} onClose={() => setMoving(null)} />}
      {closing && (
        <ConfirmDialog
          title={`Close ${closing.name}?`}
          confirmLabel="Close this place"
          danger
          onClose={() => setClosing(null)}
          body={<p>{closing.pieces > 0 ? `${closing.name} still holds ${plural(closing.pieces, 'piece')}. Move them back to the shop or to another place first.` : `${closing.name} is empty. It will be removed from the list.`}</p>}
          onConfirm={async () => {
            await api.locationArchive(closing.id);
            refresh();
            toast.success(`${closing.name} closed`);
          }}
        />
      )}
    </InventoryShell>
  );
}

function PlaceDialog({ place, onClose }: { place: Location | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState(place?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.locationSave(place?.id ?? null, name);
      refresh();
      toast.success(place ? 'Saved' : `${name.trim()} added`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={place ? 'Rename place' : 'Add a place'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Name" hint="A godown, an exhibition stall, a relative's shop.">
          <Input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Godown" />
        </Field>
      </form>
    </Modal>
  );
}

function MoveDialog({ places, holdings, variantId, onClose }: { places: Location[]; holdings: HoldingRow[]; variantId?: string; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const variants = useQuery(() => api.variantsForSale());
  const [chosen, setChosen] = useState(variantId ?? '');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>(places[0]?.id ?? '');
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const holding = holdings.find((h) => h.variantId === chosen);
  const variant = variants.data?.find((v) => v.variantId === chosen);
  const available = useMemo(() => (from === '' ? (variant?.stock ?? holding?.shop ?? 0) : (holding?.elsewhere[from] ?? 0)), [from, holding, variant]);
  const where = [{ id: '', name: SHOP_LABEL }, ...places];

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.stockTransfer({ variantId: chosen, fromId: from || null, toId: to || null, qty: Math.trunc(Number(qty) || 0), note });
      refresh();
      toast.success('Stock moved');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Move stock"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!chosen || from === to} onClick={() => void save()}>
            Move
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Saree">
          <Select value={chosen} onChange={(e) => setChosen(e.target.value)} aria-label="Saree">
            <option value="">Choose a saree</option>
            {(variants.data ?? []).map((v) => (
              <option key={v.variantId} value={v.variantId}>
                {v.designName} · {v.color} · {v.size}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From">
            <Select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
              {where.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To">
            <Select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
              {where.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="How many" hint={chosen ? `${available} available there.` : undefined}>
          <Input type="number" min={1} max={available || undefined} className="num" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Note" hint="Optional.">
          <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="For the Diwali exhibition" />
        </Field>
      </form>
    </Modal>
  );
}
