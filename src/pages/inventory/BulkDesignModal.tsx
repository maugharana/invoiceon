import { useState } from 'react';
import { formatMoney } from '../../../shared/money';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, MoneyInput, Segmented } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { toNumber } from '../../lib/format';

export type BulkKind = 'reorder' | 'price' | 'archive';

/** One dialog for the three things you can do to many designs at once. Nothing changes unless every design can be changed. */
export function BulkDesignModal({ ids, kind, onClose, onDone }: { ids: string[]; kind: BulkKind; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [level, setLevel] = useState('2');
  const [mode, setMode] = useState<'percent' | 'set'>('percent');
  const [percent, setPercent] = useState('10');
  const [price, setPrice] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const n = plural(ids.length, 'design');

  async function apply() {
    setError(null);
    setSaving(true);
    try {
      if (kind === 'archive') await api.designsBulk({ ids, kind: 'archive' });
      else if (kind === 'reorder') {
        const v = toNumber(level);
        if (!Number.isInteger(v) || v < 0) throw new Error('The reorder level must be a whole number, zero or more.');
        await api.designsBulk({ ids, kind: 'reorder', level: v });
      } else if (mode === 'percent') {
        const v = toNumber(percent);
        if (!Number.isFinite(v) || v === 0) throw new Error('Enter how many percent to change the prices by.');
        await api.designsBulk({ ids, kind: 'price', mode: 'percent', value: v });
      } else {
        if (price <= 0) throw new Error('Enter the new price.');
        await api.designsBulk({ ids, kind: 'price', mode: 'set', value: price });
      }
      refresh();
      toast.success(kind === 'archive' ? `${n} archived` : kind === 'reorder' ? `Reorder level set on ${n}` : `Prices changed on ${n}`);
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const title = kind === 'archive' ? `Archive ${n}?` : kind === 'reorder' ? `Set the reorder level for ${n}` : `Change prices for ${n}`;
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={kind === 'archive' ? 'danger' : 'primary'} loading={saving} onClick={() => void apply()}>
            {kind === 'archive' ? 'Archive' : 'Apply'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {kind === 'archive' && <p>They leave your inventory lists and valuation, along with any stock they hold. Past invoices that mention them are kept, and you can undo this straight after.</p>}
        {kind === 'reorder' && (
          <Field label="Reorder level" hint="A variant counts as low when its stock is at or below this. It applies to every variant of the chosen designs.">
            <Input type="number" min={0} step={1} value={level} onChange={(e) => setLevel(e.target.value)} className="num" data-autofocus />
          </Field>
        )}
        {kind === 'price' && (
          <>
            <Segmented
              label="How to change prices"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'percent', label: 'Raise or lower by %' },
                { value: 'set', label: 'Set one price' },
              ]}
            />
            {mode === 'percent' ? (
              <Field label="Change by (%)" hint="Use a minus sign to lower prices, e.g. −10. Prices are before GST; each is rounded to the paisa.">
                <Input value={percent} onChange={(e) => setPercent(e.target.value)} className="num" inputMode="decimal" data-autofocus />
              </Field>
            ) : (
              <Field label="New selling price" hint={`Every variant of these designs will sell at this price${price > 0 ? ` (${formatMoney(price, { fractionDigits: 0 })})` : ''}, before GST.`}>
                <MoneyInput value={price} onChange={setPrice} data-autofocus />
              </Field>
            )}
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
