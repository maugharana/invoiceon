import { useState } from 'react';
import type { BulkSareeRow, SaleVariant } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { Button, ErrorNote, Field, Input, MoneyInput } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { toNumber } from '../../lib/format';

/**
 * Saves a saree that isn't in the inventory yet, without leaving the invoice. It goes in as a normal design and piece, so it shows up
 * in Inventory straight away. `stock` is how many pieces to receive: the invoice takes its pieces out again when it is issued.
 */
export function QuickAddItemModal({ initialName, quote, onClose, onAdded }: { initialName: string; quote: boolean; onClose: () => void; onAdded: (v: SaleVariant) => void }) {
  const [name, setName] = useState(initialName.trim());
  const [color, setColor] = useState('');
  const [size, setSize] = useState('6.3 m');
  const [price, setPrice] = useState(0);
  const [stock, setStock] = useState(quote ? '0' : '1');
  const [more, setMore] = useState(false);
  const [mrp, setMrp] = useState(0);
  const [cost, setCost] = useState(0);
  const [fabric, setFabric] = useState('');
  const [hsn, setHsn] = useState('');
  const [nickname, setNickname] = useState('');
  const [sku, setSku] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pieces = toNumber(stock);
  const problem = !name.trim() ? 'Enter the saree name.' : !color.trim() ? 'Enter the colour.' : !size.trim() ? 'Enter the size.' : price <= 0 ? 'Enter the selling price.' : !Number.isInteger(pieces) || pieces < 0 ? 'Pieces in stock should be a whole number, 0 or more.' : null;

  async function save() {
    if (problem) return;
    setSaving(true);
    setError(null);
    const row: BulkSareeRow = { name, nickname, sku, color, size, fabric, hsn, mrpPaise: mrp, sellPricePaise: price, costPaise: cost, stock: pieces, reorderLevel: 0 };
    try {
      onAdded(await api.inventoryQuickAdd(row));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add to inventory"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!!problem} onClick={() => void save()}>
            Add and use on invoice
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-sm text-ink-muted">This saree isn't in your inventory yet. Save it here and it is added to the invoice too. It will show under Inventory straight away.</p>
        <Field label="Saree name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Colour">
            <Input value={color} onChange={(e) => setColor(e.target.value)} maxLength={40} />
          </Field>
          <Field label="Size">
            <Input value={size} onChange={(e) => setSize(e.target.value)} maxLength={30} />
          </Field>
          <Field label="Selling price" hint="Before GST">
            <MoneyInput value={price} onChange={setPrice} />
          </Field>
          <Field label="Pieces in stock" hint={quote ? 'A quote takes no stock' : 'Pieces you have now. The invoice takes its pieces out.'}>
            <Input value={stock} inputMode="numeric" onChange={(e) => setStock(e.target.value.replace(/\D/g, '').slice(0, 6))} className="num" />
          </Field>
        </div>
        <button type="button" onClick={() => setMore((m) => !m)} className="text-xs text-brand hover:underline" aria-expanded={more}>
          {more ? 'Hide other details' : 'Other details: MRP, cost, fabric, HSN'}
        </button>
        {more && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="MRP" hint="Printed price with GST">
              <MoneyInput value={mrp} onChange={setMrp} />
            </Field>
            <Field label="Cost price" hint="Used for profit reports">
              <MoneyInput value={cost} onChange={setCost} />
            </Field>
            <Field label="Fabric">
              <Input value={fabric} onChange={(e) => setFabric(e.target.value)} maxLength={60} />
            </Field>
            <Field label="HSN code">
              <Input value={hsn} onChange={(e) => setHsn(e.target.value)} maxLength={12} className="num" />
            </Field>
            <Field label="Short name">
              <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </Field>
            <Field label="Saree ID" hint="Left blank, one is made for you">
              <Input value={sku} onChange={(e) => setSku(e.target.value)} maxLength={40} />
            </Field>
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
