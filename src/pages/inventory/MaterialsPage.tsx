import { History, PackageMinus, Pencil, Plus, ShoppingBasket, Trash2, TrendingUp, Wrench } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { formatDate } from '../../../shared/gst';
import type { Material } from '../../../shared/types';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, IconButton, Input, Money, MoneyInput, Pill, SearchInput, Select, TableSkeleton } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { InventoryShell } from './InventoryTabs';
import { AdjustMaterialModal, MaterialHistoryModal, PurchaseModal, SimulatorModal, SupplierSelect } from './MaterialModals';

const UNITS = ['kg', 'g', 'm', 'pc', 'spool', 'litre'];

function MaterialModal({ material, categories, onClose }: { material?: Material; categories: string[]; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState(material?.name ?? '');
  const [unit, setUnit] = useState(material?.unit ?? 'kg');
  const [cost, setCost] = useState(material?.unitCostPaise ?? 0);
  const [category, setCategory] = useState(material?.category ?? '');
  const [reorder, setReorder] = useState(material && material.reorderQty > 0 ? String(material.reorderQty) : '');
  const [opening, setOpening] = useState('');
  const [supplierId, setSupplierId] = useState(material?.supplierId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = { name, unit, unitCostPaise: cost, category, reorderQty: Number(reorder) || 0, supplierId: supplierId || null, ...(material ? {} : { openingQty: Number(opening) || 0 }) };
      if (material) await api.materialUpdate(material.id, input);
      else await api.materialCreate(input);
      refresh();
      toast.success(material ? 'Material updated' : `${name.trim()} added`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={material ? 'Edit raw material' : 'New raw material'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="material-form" loading={saving}>
            {material ? 'Save changes' : 'Add material'}
          </Button>
        </>
      }
    >
      <form id="material-form" onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pure silk yarn" data-autofocus />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Unit">
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} list="unit-options" />
            <datalist id="unit-options">
              {UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>
          <Field label={`Cost per ${unit.trim() || 'unit'}`}>
            <MoneyInput value={cost} onChange={setCost} />
          </Field>
          <Field label="Group">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} list="material-categories" placeholder="Yarn, dye, packing…" maxLength={40} />
            <datalist id="material-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {!material && (
            <Field label={`In hand now (${unit.trim() || 'units'})`} hint="Later changes go through purchases and adjustments">
              <Input value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" placeholder="0" className="num" />
            </Field>
          )}
          <Field label={`Warn me at (${unit.trim() || 'units'})`} hint="Told when stock falls to this. Empty means don't watch it.">
            <Input value={reorder} onChange={(e) => setReorder(e.target.value)} inputMode="decimal" placeholder="Not watched" className="num" />
          </Field>
        </div>
        <SupplierSelect value={supplierId} onChange={setSupplierId} label="Usually bought from" />
        {material && material.usedInCount > 0 && (
          <p className="rounded-lg bg-canvas px-3 py-2.5 text-xs text-ink-muted">
            Used in {plural(material.usedInCount, 'variant')}. Changing the price updates their cost and stock value straight away, and the old price stays in its history.
          </p>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

export function MaterialsPage() {
  const toast = useToast();
  const refresh = useRefresh();
  const materials = useQuery(() => api.materialsList());
  const purchases = useQuery(() => api.purchasesList());
  const [editing, setEditing] = useState<Material | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Material | null>(null);
  const [adjusting, setAdjusting] = useState<Material | null>(null);
  const [history, setHistory] = useState<Material | null>(null);
  const [buying, setBuying] = useState<{ materialId?: string } | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [undoing, setUndoing] = useState<string | null>(null);

  const all = materials.data ?? [];
  const categories = useMemo(() => [...new Set(all.map((m) => m.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [all]);
  const shown = all.filter((m) => (!category || m.category === category) && `${m.name} ${m.category} ${m.supplierName}`.toLowerCase().includes(search.trim().toLowerCase()));
  const low = all.filter((m) => m.status !== 'ok').length;

  return (
    <InventoryShell
      tab="materials"
      actions={
        <>
          <Button icon={<TrendingUp className="h-4 w-4" />} disabled={all.length === 0} onClick={() => setSimulating(true)} title="See what a change in material prices would do to your margins">
            What if prices change?
          </Button>
          <Button icon={<ShoppingBasket className="h-4 w-4" />} disabled={all.length === 0} onClick={() => setBuying({})}>
            Buy materials
          </Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Add material
          </Button>
        </>
      }
    >
      {materials.error && <ErrorNote>{materials.error}</ErrorNote>}
      {low > 0 && (
        <div className="mb-4 rounded-lg bg-status-partial-bg px-4 py-3 text-status-partial-fg">
          {plural(low, 'material is', 'materials are')} running low or out: {all.filter((m) => m.status !== 'ok').map((m) => m.name).join(', ')}.
        </div>
      )}
      {all.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search material, group or supplier" />
          {categories.length > 0 && (
            <div className="w-44">
              <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Group">
                <option value="">All groups</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}
      <Card className="overflow-x-auto">
        {materials.loading ? (
          <TableSkeleton />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Wrench className="h-6 w-6" />}
            title="No raw materials yet"
            body="Add the yarn, zari, dye and packaging that go into a saree. Variants can then work out their own cost, and it stays right when prices change."
            actions={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                Add material
              </Button>
            }
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Material</th>
                <th className="th text-right">In hand</th>
                <th className="th text-right">Cost per unit</th>
                <th className="th">Usually from</th>
                <th className="th text-right">Used in</th>
                <th className="w-40" />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id} className="animate-fade-in border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas">
                  <td className="td">
                    {m.name}
                    {m.category && <div className="text-xs text-ink-muted">{m.category}</div>}
                  </td>
                  <td className="td text-right">
                    <span className="num">
                      {m.stockQty} <span className="text-ink-muted">{m.unit}</span>
                    </span>
                    {m.status !== 'ok' && (
                      <div>
                        <Pill tone={m.status === 'out' ? 'overdue' : 'partial'}>{m.status === 'out' ? 'Out' : 'Low'}</Pill>
                      </div>
                    )}
                  </td>
                  <td className="td text-right">
                    <Money paise={m.unitCostPaise} />
                    <div className="text-xs text-ink-muted">per {m.unit}</div>
                  </td>
                  <td className="td text-ink-muted">{m.supplierName || '—'}</td>
                  <td className="td num text-right text-ink-muted">{m.usedInCount === 0 ? '—' : plural(m.usedInCount, 'variant')}</td>
                  <td className="td">
                    <div className="flex justify-end gap-0.5">
                      <IconButton label={`Buy ${m.name}`} onClick={() => setBuying({ materialId: m.id })}>
                        <ShoppingBasket className="h-4 w-4" />
                      </IconButton>
                      <IconButton label={`Take out or correct ${m.name}`} onClick={() => setAdjusting(m)}>
                        <PackageMinus className="h-4 w-4" />
                      </IconButton>
                      <IconButton label={`History of ${m.name}`} onClick={() => setHistory(m)}>
                        <History className="h-4 w-4" />
                      </IconButton>
                      <IconButton label={`Edit ${m.name}`} onClick={() => setEditing(m)}>
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton label={`Delete ${m.name}`} onClick={() => setDeleting(m)}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="td text-center text-ink-muted">
                    No material matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      {(purchases.data?.length ?? 0) > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-base">Recent purchases</h2>
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="th">Date</th>
                  <th className="th">Bought from</th>
                  <th className="th">Bill</th>
                  <th className="th text-right">Items</th>
                  <th className="th text-right">Total</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {purchases.data?.slice(0, 8).map((p) => (
                  <tr key={p.id} className="border-b border-line/70 last:border-0">
                    <td className="td num whitespace-nowrap text-ink-muted">{formatDate(p.date)}</td>
                    <td className="td">{p.supplierName || <span className="text-ink-muted">—</span>}</td>
                    <td className="td num text-ink-muted">{p.billNo || '—'}</td>
                    <td className="td num text-right">{p.lineCount}</td>
                    <td className="td text-right">
                      <Money paise={p.totalPaise} />
                    </td>
                    <td className="td">
                      <IconButton
                        label={`Take back the purchase of ${formatDate(p.date)}`}
                        disabled={undoing === p.id}
                        onClick={async () => {
                          setUndoing(p.id);
                          try {
                            await api.purchaseDelete(p.id);
                            refresh();
                            toast.success('Purchase taken back — its stock and expense are removed');
                          } catch (err) {
                            toast.error(errorMessage(err));
                          } finally {
                            setUndoing(null);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {editing && <MaterialModal material={editing === 'new' ? undefined : editing} categories={categories} onClose={() => setEditing(null)} />}
      {adjusting && <AdjustMaterialModal material={adjusting} onClose={() => setAdjusting(null)} />}
      {history && <MaterialHistoryModal material={history} onClose={() => setHistory(null)} />}
      {buying && <PurchaseModal materials={all} presetMaterialId={buying.materialId} onClose={() => setBuying(null)} />}
      {simulating && <SimulatorModal materials={all} onClose={() => setSimulating(false)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete raw material?"
          confirmLabel="Delete"
          danger
          body={<>“{deleting.name}” will be removed from your list. This can't be done while a variant's costing still uses it.</>}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.materialDelete(deleting.id);
            refresh();
            toast.success(`${deleting.name} deleted`);
          }}
        />
      )}
    </InventoryShell>
  );
}
