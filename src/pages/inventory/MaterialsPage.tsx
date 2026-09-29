import { Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Material } from '../../../shared/types';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, IconButton, Input, Money, MoneyInput, TableSkeleton } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { InventoryShell } from './InventoryTabs';

const UNITS = ['kg', 'g', 'm', 'pc', 'spool', 'litre'];

function MaterialModal({ material, onClose }: { material?: Material; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState(material?.name ?? '');
  const [unit, setUnit] = useState(material?.unit ?? 'kg');
  const [cost, setCost] = useState(material?.unitCostPaise ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = { name, unit, unitCostPaise: cost };
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
      size="sm"
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
        <div className="grid grid-cols-2 gap-4">
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
        </div>
        {material && material.usedInCount > 0 && (
          <p className="rounded-lg bg-canvas px-3 py-2.5 text-xs text-ink-muted">
            Used in {plural(material.usedInCount, 'variant')}. Changing the price updates their cost and stock value straight away.
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
  const [editing, setEditing] = useState<Material | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Material | null>(null);

  return (
    <InventoryShell
      tab="materials"
      actions={
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          Add material
        </Button>
      }
    >
      {materials.error && <ErrorNote>{materials.error}</ErrorNote>}
      <Card className="overflow-x-auto">
        {materials.loading ? (
          <TableSkeleton />
        ) : materials.data?.length === 0 ? (
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
                <th className="th">Unit</th>
                <th className="th text-right">Cost per unit</th>
                <th className="th text-right">Used in</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {materials.data?.map((m) => (
                <tr key={m.id} className="animate-fade-in border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas">
                  <td className="td">{m.name}</td>
                  <td className="td text-ink-muted">{m.unit}</td>
                  <td className="td text-right">
                    <Money paise={m.unitCostPaise} />
                  </td>
                  <td className="td num text-right text-ink-muted">{m.usedInCount === 0 ? '—' : plural(m.usedInCount, 'variant')}</td>
                  <td className="td">
                    <div className="flex justify-end gap-0.5">
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
            </tbody>
          </table>
        )}
      </Card>

      {editing && <MaterialModal material={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
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
