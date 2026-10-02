import { useMemo, useState } from 'react';
import { buildPieceTitle, DEFAULT_OPTIONS } from '../../../shared/nomenclature';
import type { BulkSareeRow, SaleVariant } from '../../../shared/types';
import { ChoiceInput } from '../../components/ChoiceInput';
import { Modal } from '../../components/Modal';
import { Button, ErrorNote, Field, Input, MoneyInput } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { toNumber } from '../../lib/format';

/**
 * Saves a saree that isn't in the inventory yet, without leaving the invoice. It goes in as a normal design and piece, so it shows up
 * in Inventory straight away. The name is built from the choices (see shared/nomenclature.ts), so every saree is named the same way.
 * `stock` is how many pieces to receive: the invoice takes its pieces out again when it is issued.
 */
export function QuickAddItemModal({ initialName, quote, onClose, onAdded }: { initialName: string; quote: boolean; onClose: () => void; onAdded: (v: SaleVariant) => void }) {
  const options = useQuery(() => api.catalogueOptions());
  const lists = options.data ?? DEFAULT_OPTIONS;

  // What was typed in the item box is a weave style when it matches one (Banarasi), otherwise the saree's special name when it is one word.
  const typed = initialName.trim();
  const typedWeave = DEFAULT_OPTIONS.weaveStyle.find((w) => w.toLowerCase() === typed.toLowerCase()) ?? '';
  const [weaveStyle, setWeaveStyle] = useState(typedWeave);
  const [fabric, setFabric] = useState('');
  const [technique, setTechnique] = useState('');
  const [work, setWork] = useState('');
  const [color, setColor] = useState('');
  const [nickname, setNickname] = useState(!typedWeave && typed && !/\s/.test(typed) ? typed : '');
  const [size, setSize] = useState('6.3 m');
  const [price, setPrice] = useState(0);
  const [cost, setCost] = useState(0);
  const [stock, setStock] = useState(quote ? '0' : '1');
  const [more, setMore] = useState(false);
  const [mrp, setMrp] = useState(0);
  const [hsn, setHsn] = useState('');
  const [sku, setSku] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => buildPieceTitle({ weaveStyle, fabric, technique, work, specialName: nickname }, color), [weaveStyle, fabric, technique, work, nickname, color]);
  const pieces = toNumber(stock);
  const problem = !weaveStyle.trim() ? 'Choose the weave style.' : !color.trim() ? 'Choose the colour.' : /\s/.test(nickname.trim()) ? 'The special name must be one word.' : !size.trim() ? 'Enter the size.' : price <= 0 ? 'Enter the selling price.' : !Number.isInteger(pieces) || pieces < 0 ? 'Pieces in stock should be a whole number, 0 or more.' : null;

  async function save() {
    if (problem) return;
    setSaving(true);
    setError(null);
    // The name is left empty on purpose: it is built from the choices, here and everywhere else, the same way.
    const row: BulkSareeRow = { name: '', weaveStyle, technique, work, nickname: nickname.trim(), sku, color, size, fabric, hsn, mrpPaise: mrp, sellPricePaise: price, costPaise: cost, stock: pieces, reorderLevel: 0 };
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
      size="lg"
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
        <p className="text-sm text-ink-muted">This saree isn't in your inventory yet. Pick its details here and it is saved to Inventory and added to the invoice. Pick from the list, or type to add a new choice.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Weave style">
            <ChoiceInput options={lists.weaveStyle} value={weaveStyle} onChange={setWeaveStyle} placeholder="Banarasi, Kanjivaram…" aria-label="Weave style" autoFocus />
          </Field>
          <Field label="Fabric">
            <ChoiceInput options={lists.fabric} value={fabric} onChange={setFabric} placeholder="Katan Silk, Georgette…" aria-label="Fabric" />
          </Field>
          <Field label="Technique" hint="How it is woven">
            <ChoiceInput options={lists.technique} value={technique} onChange={setTechnique} placeholder="Kadhua, Phekua…" aria-label="Technique" />
          </Field>
          <Field label="Special work" hint="You can pick more than one">
            <ChoiceInput multi options={lists.work} value={work} onChange={setWork} placeholder="Zardozi, Aari…" aria-label="Special work" />
          </Field>
          <Field label="Colour">
            <ChoiceInput options={lists.colour} value={color} onChange={setColor} placeholder="Maroon, Emerald Green…" aria-label="Colour" />
          </Field>
          <Field label="Special name" hint="Your own one-word name for it. It goes last in the title.">
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20} placeholder="Lalima" />
          </Field>
        </div>
        <div className="rounded-lg border border-line bg-canvas px-3 py-2">
          <div className="text-xs text-ink-muted">Full name, as it will be saved</div>
          <div className="mt-0.5 text-sm">{title || <span className="text-ink-muted">Pick the weave style and colour to see it.</span>}</div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Size">
            <Input value={size} onChange={(e) => setSize(e.target.value)} maxLength={30} />
          </Field>
          <Field label="Selling price" hint="Before GST">
            <MoneyInput value={price} onChange={setPrice} />
          </Field>
          <Field label="Cost price" hint="For profit figures">
            <MoneyInput value={cost} onChange={setCost} />
          </Field>
          <Field label="Pieces in stock">
            <Input value={stock} inputMode="numeric" onChange={(e) => setStock(e.target.value.replace(/\D/g, '').slice(0, 6))} className="num" />
          </Field>
        </div>
        {quote && <p className="-mt-2 text-xs text-ink-muted">A quote takes no stock, so pieces start at 0.</p>}
        <button type="button" onClick={() => setMore((m) => !m)} className="text-xs text-brand hover:underline" aria-expanded={more}>
          {more ? 'Hide other details' : 'Other details: MRP, HSN, Saree ID'}
        </button>
        {more && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="MRP" hint="Printed price with GST">
              <MoneyInput value={mrp} onChange={setMrp} />
            </Field>
            <Field label="HSN code">
              <Input value={hsn} onChange={(e) => setHsn(e.target.value)} maxLength={12} className="num" />
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
