import { useState, type FormEvent } from 'react';
import type { ManualStockReason, StockReason, Variant } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Money, Segmented, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { formatDateTime, toNumber } from '../../lib/format';

export const REASON_LABEL: Record<StockReason, string> = {
  opening: 'Opening stock',
  purchase: 'Purchase / received',
  production: 'Production',
  sale: 'Sale',
  return: 'Customer return',
  adjustment: 'Stock count correction',
  damage: 'Damaged / lost',
};

const ADD_REASONS: ManualStockReason[] = ['purchase', 'production', 'return', 'adjustment'];
const REMOVE_REASONS: ManualStockReason[] = ['damage', 'adjustment'];

export function AdjustStockModal({ variant, onClose }: { variant: Variant; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<ManualStockReason>('purchase');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const amount = toNumber(qty);
  const valid = Number.isInteger(amount) && amount > 0;
  const delta = valid ? (direction === 'add' ? amount : -amount) : 0;
  const after = variant.stock + delta;
  const tooMany = valid && after < 0;
  const reasons = direction === 'add' ? ADD_REASONS : REMOVE_REASONS;

  function changeDirection(next: 'add' | 'remove') {
    setDirection(next);
    setReason(next === 'add' ? 'purchase' : 'damage');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return setError('Enter a whole number of pieces.');
    setSaving(true);
    setError(null);
    try {
      await api.stockAdjust({ variantId: variant.id, delta, reason, note });
      refresh();
      toast.success(`${variant.color} / ${variant.size}: ${variant.stock} → ${after}`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Adjust stock"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="stock-form" loading={saving} disabled={!valid || tooMany}>
            Update stock
          </Button>
        </>
      }
    >
      <form id="stock-form" onSubmit={submit} className="space-y-4">
        <div>
          <div className="text-ink">
            {variant.color} / {variant.size}
          </div>
          <div className="text-xs text-ink-muted">{variant.sku}</div>
        </div>

        <Segmented
          label="Direction"
          value={direction}
          onChange={changeDirection}
          options={[
            { value: 'add', label: 'Add stock' },
            { value: 'remove', label: 'Remove stock' },
          ]}
        />

        <div className="grid grid-cols-2 gap-4">
          <Field label="Pieces">
            <Input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className="num text-right" placeholder="0" data-autofocus />
          </Field>
          <Field label="Reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value as ManualStockReason)}>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. weaver name, batch" />
        </Field>

        <div className="flex items-center justify-between rounded-lg bg-canvas px-3 py-2.5 text-sm">
          <span className="text-ink-muted">In stock</span>
          <span className="num">
            {variant.stock}
            {valid && (
              <>
                <span className="mx-2 text-ink-muted">→</span>
                <span key={after} className={`animate-tick inline-block ${tooMany ? 'text-status-overdue-fg' : 'font-medium'}`}>
                  {after}
                </span>
              </>
            )}
          </span>
        </div>
        {tooMany && <ErrorNote>Only {variant.stock} in stock — you can't remove {amount}.</ErrorNote>}
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

export function StockHistoryModal({ variant, onClose }: { variant: Variant; onClose: () => void }) {
  const history = useQuery(() => api.stockMovements(variant.id), [variant.id]);
  return (
    <Modal
      title={`Stock history — ${variant.color} / ${variant.size}`}
      size="lg"
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {history.loading ? (
        <Spinner />
      ) : history.error ? (
        <ErrorNote>{history.error}</ErrorNote>
      ) : history.data?.length === 0 ? (
        <p className="py-6 text-center text-ink-muted">No stock movements yet.</p>
      ) : (
        <div className="-mx-2 max-h-[50vh] overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th">When</th>
                <th className="th">Reason</th>
                <th className="th text-right">Change</th>
                <th className="th text-right">Balance</th>
                <th className="th text-right">Cost / pc</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.map((m) => (
                <tr key={m.id} className="border-b border-line/60 last:border-0">
                  <td className="td whitespace-nowrap text-ink-muted">{formatDateTime(m.createdAt)}</td>
                  <td className="td">
                    {REASON_LABEL[m.reason]}
                    {m.note && <div className="text-xs text-ink-muted">{m.note}</div>}
                  </td>
                  <td className={`td num text-right ${m.delta > 0 ? 'text-status-paid-fg' : 'text-status-overdue-fg'}`}>
                    {m.delta > 0 ? '+' : '−'}
                    {Math.abs(m.delta)}
                  </td>
                  <td className="td num text-right">{m.balanceAfter}</td>
                  <td className="td text-right">
                    <Money paise={m.unitCostPaise} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
