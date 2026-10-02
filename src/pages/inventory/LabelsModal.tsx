import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LABEL_LAYOUTS, type LabelItem, type LabelLayout } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { toNumber } from '../../lib/format';
import { paths } from '../../lib/router';

/** Labels to stick on sarees: choose how many of each piece and the paper, then print or save as a PDF. Each carries a barcode of the Saree ID. */
export function LabelsModal({ variantIds, stock, onClose }: { variantIds: string[]; /** How many of each piece are in stock, to start the counts from. */ stock: Record<string, number>; onClose: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<LabelItem[] | null>(null);
  const [copies, setCopies] = useState<Record<string, string>>({});
  const [layout, setLayout] = useState<LabelLayout>('a4-24');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .labelItems(variantIds)
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setCopies(Object.fromEntries(list.map((l) => [l.variantId, String(Math.max(1, stock[l.variantId] ?? 1))])));
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantIds.join(',')]);

  const chosen = (items ?? []).map((l) => ({ variantId: l.variantId, copies: Math.max(0, Math.round(toNumber(copies[l.variantId] ?? '') || 0)) })).filter((c) => c.copies > 0);
  const total = chosen.reduce((s, c) => s + c.copies, 0);
  const l = LABEL_LAYOUTS[layout];
  const sheets = Math.ceil(total / (l.columns * l.rows));

  async function output(kind: 'pdf' | 'print') {
    // In a plain browser there is no desktop shell to write the file, so the labels open in a tab, where the browser's own print dialog does it.
    if (!window.invoiceon) {
      window.open(`${location.origin}${location.pathname}#${paths.printLabels(chosen, layout)}`, '_blank');
      toast.info('Opened in a new tab: print there, and set margins to None and scale to 100%.');
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'pdf') {
        if ((await api.labelsExportPdf(chosen, layout)).saved) toast.success('PDF saved');
      } else await api.labelsPrint(chosen, layout);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      title="Print labels"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button loading={busy === 'pdf'} disabled={total === 0 || busy !== null} onClick={() => void output('pdf')}>
            Save PDF
          </Button>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} loading={busy === 'print'} disabled={total === 0 || busy !== null} onClick={() => void output('print')}>
            {total > 0 ? `Print ${total} ${total === 1 ? 'label' : 'labels'}` : 'Print'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">Each label has the saree's name, colour, size, price and a barcode of its Saree ID{l.qr ? ' with a QR code' : ''}. A handheld scanner reads the barcode into the item box on an invoice.</p>
        <Field label="Paper">
          <Select value={layout} onChange={(e) => setLayout(e.target.value as LabelLayout)}>
            {(Object.keys(LABEL_LAYOUTS) as LabelLayout[]).map((k) => (
              <option key={k} value={k}>
                {LABEL_LAYOUTS[k].label}
              </option>
            ))}
          </Select>
        </Field>
        {!items && !error && <Spinner />}
        {items && (
          <ul className="max-h-72 overflow-y-auto rounded-lg border border-line">
            {items.map((it) => (
              <li key={it.variantId} className="flex items-center justify-between gap-4 border-b border-line/70 px-4 py-2 last:border-0">
                <span className="min-w-0">
                  <span className="block truncate">{it.designName}</span>
                  <span className="num text-xs text-ink-muted">
                    {it.color} · {it.size} · {it.sku}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-ink-muted">labels</span>
                  <Input value={copies[it.variantId] ?? ''} inputMode="numeric" aria-label={`Labels of ${it.designName} ${it.color}`} onChange={(e) => setCopies((c) => ({ ...c, [it.variantId]: e.target.value.replace(/\D/g, '').slice(0, 4) }))} className="num h-8 w-20 text-right" />
                </span>
              </li>
            ))}
          </ul>
        )}
        {total > 0 && <p className="text-xs text-ink-muted">{layout === 'roll' ? `${total} labels, one to a page.` : `${total} labels on ${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}.`} When you print, set margins to None and the scale to 100% so the labels line up.</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
