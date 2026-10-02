import { AlertTriangle, ArrowLeft, ClipboardPaste, Copy, Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { parseMoney } from '../../../shared/money';
import type { BulkSareeRow } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Money, PageHeader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural, toNumber } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { COMMON_COLORS, COMMON_FABRICS, COMMON_SIZES } from '../../lib/sarees';

// ── The sheet ───────────────────────────────────────────────────────────────
// One row is one piece: a saree in one colour and size. Everything is held as text while it's being typed.
type Field = 'name' | 'nickname' | 'sku' | 'color' | 'size' | 'fabric' | 'hsn' | 'mrp' | 'sp' | 'cp' | 'stock' | 'reorder';

interface SheetRow {
  id: number;
  name: string;
  nickname: string;
  sku: string;
  color: string;
  size: string;
  fabric: string;
  hsn: string;
  mrp: string;
  sp: string;
  cp: string;
  stock: string;
  reorder: string;
}

interface Column {
  field: Field;
  label: string;
  title: string;
  width: string;
  align?: 'right';
  placeholder?: string;
  list?: string;
  inputMode?: 'decimal' | 'numeric';
  /** Only shown after "More columns". */
  extra?: boolean;
  required?: boolean;
}

const COLUMNS: Column[] = [
  { field: 'name', label: 'Saree name', title: 'Rows with the same name become one design with several colours', width: 'min-w-[10rem]', placeholder: 'e.g. Mau Silk Butidar', list: 'saree-names', required: true },
  { field: 'nickname', label: 'Special name', title: 'Your own name for the saree, a word or a short phrase, like Lalima or Rang Bahar. Taken from the first row that has one in each design.', width: 'w-[6rem]', placeholder: 'Kadhua' },
  { field: 'sku', label: 'Saree ID', title: 'The SKU: your own code for this piece. Leave blank and one is made for you.', width: 'w-[5.75rem]', placeholder: 'auto' },
  { field: 'color', label: 'Colour', title: 'Colour', width: 'w-[5.75rem]', placeholder: 'Maroon', list: 'saree-colors', required: true },
  { field: 'size', label: 'Size', title: 'Length', width: 'w-[5rem]', placeholder: '6.3 m', list: 'saree-sizes', required: true },
  { field: 'fabric', label: 'Fabric', title: 'Taken from the first row of each design', width: 'w-[8rem]', placeholder: 'Pure silk', list: 'saree-fabrics', extra: true },
  { field: 'hsn', label: 'HSN', title: 'Taken from the first row of each design', width: 'w-[5.5rem]', placeholder: '5007', inputMode: 'numeric', extra: true },
  { field: 'mrp', label: 'MRP ₹', title: 'The printed maximum retail price, GST included', width: 'w-[5.5rem]', align: 'right', placeholder: '0', inputMode: 'decimal' },
  { field: 'sp', label: 'SP ₹', title: 'Selling price: what you charge, before GST', width: 'w-[5.5rem]', align: 'right', placeholder: '0', inputMode: 'decimal', required: true },
  { field: 'cp', label: 'CP ₹', title: 'Cost price: what it costs you to make or buy', width: 'w-[5.5rem]', align: 'right', placeholder: '0', inputMode: 'decimal' },
  { field: 'stock', label: 'Stock', title: 'Pieces on the shelf today', width: 'w-[4rem]', align: 'right', placeholder: '0', inputMode: 'numeric' },
  { field: 'reorder', label: 'Reorder at', title: 'Warn when stock falls to this many', width: 'w-[5rem]', align: 'right', placeholder: '2', inputMode: 'numeric', extra: true },
];

let nextId = 1;
const blankRow = (size = '6.3 m', reorder = '2'): SheetRow => ({ id: nextId++, name: '', nickname: '', sku: '', color: '', size, fabric: '', hsn: '', mrp: '', sp: '', cp: '', stock: '', reorder });

/** Size and reorder level are defaults, so a row counts as empty until something else is typed in it. */
const isBlank = (r: SheetRow) => !(r.name || r.nickname || r.sku || r.color || r.fabric || r.hsn || r.mrp || r.sp || r.cp || r.stock);

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Money typed in a cell ("1,250", "₹ 9800") → paise. Blank is 0. Null when it isn't an amount. */
function toPaise(text: string): number | null {
  return text.trim() === '' ? 0 : parseMoney(text);
}

function toCount(text: string): number | null {
  if (text.trim() === '') return 0;
  const n = toNumber(text);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** What is wrong with a row before it is even sent, in words. */
function problemsOf(r: SheetRow): string | null {
  if (!r.name.trim()) return 'Saree name is required.';
  if (!r.color.trim()) return 'Colour is required.';
  if (!r.size.trim()) return 'Size is required.';
  if (toPaise(r.mrp) === null) return "MRP isn't a valid amount.";
  if (r.sp.trim() === '' || toPaise(r.sp) === null) return r.sp.trim() === '' ? 'Selling price (SP) is required.' : "SP isn't a valid amount.";
  if (toPaise(r.cp) === null) return "CP isn't a valid amount.";
  if (toCount(r.stock) === null) return 'Stock must be a whole number.';
  if (toCount(r.reorder) === null) return 'Reorder level must be a whole number.';
  return null;
}

/** Things worth a second look but not wrong: shown, never blocking. */
function warningOf(r: SheetRow): string | null {
  const mrp = toPaise(r.mrp) ?? 0;
  const sp = toPaise(r.sp) ?? 0;
  const cp = toPaise(r.cp) ?? 0;
  if (mrp > 0 && sp > mrp) return 'SP is higher than the MRP.';
  if (sp > 0 && cp > sp) return 'CP is higher than SP — you would sell at a loss.';
  return null;
}

const START_ROWS = 6;

export function AddSareesPage() {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const designs = useQuery(() => api.designsList());
  const defaultReorder = String(settings.data?.defaultReorderLevel ?? 2);

  const [rows, setRows] = useState<SheetRow[]>(() => Array.from({ length: START_ROWS }, () => blankRow()));
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cells = useRef(new Map<string, HTMLInputElement>());

  const columns = COLUMNS.filter((c) => more || !c.extra);
  const existing = useMemo(() => new Map((designs.data ?? []).map((d) => [norm(d.name), d])), [designs.data]);

  // ── Editing ──
  const setCell = (id: number, field: Field, value: string) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    if (errors[id]) setErrors(({ [id]: _gone, ...rest }) => rest);
  };
  const addRows = (n: number) =>
    setRows((rs) => {
      const size = rs.at(-1)?.size || '6.3 m';
      return [...rs, ...Array.from({ length: n }, () => blankRow(size, defaultReorder))];
    });
  const removeRow = (id: number) => setRows((rs) => (rs.length <= 1 ? [blankRow('6.3 m', defaultReorder)] : rs.filter((r) => r.id !== id)));
  const duplicateRow = (id: number) => {
    const at = rows.findIndex((r) => r.id === id);
    if (at < 0) return;
    // The next colour of the same saree: everything stays the same except what makes it a different piece.
    const copy: SheetRow = { ...rows[at]!, id: nextId++, sku: '', color: '', stock: '' };
    setRows((rs) => [...rs.slice(0, at + 1), copy, ...rs.slice(at + 1)]);
    requestAnimationFrame(() => cells.current.get(`${copy.id}:color`)?.focus());
  };

  const focusCell = (rowId: number, field: Field) => cells.current.get(`${rowId}:${field}`)?.focus();

  // Enter or the arrow keys move down a column, like a spreadsheet. Past the last row, Enter starts a new one.
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, index: number, field: Field) {
    // Cells with suggestions keep their arrow keys for the suggestion list; Enter still moves down.
    const hasSuggestions = !!columns.find((c) => c.field === field)?.list;
    const down = e.key === 'Enter' || (!hasSuggestions && e.key === 'ArrowDown');
    const up = !hasSuggestions && e.key === 'ArrowUp';
    if (!down && !up) return;
    e.preventDefault();
    const target = index + (down ? 1 : -1);
    if (target < 0) return;
    if (target >= rows.length) {
      if (e.key !== 'Enter') return;
      const fresh = blankRow(rows.at(-1)?.size || '6.3 m', defaultReorder);
      setRows((rs) => [...rs, fresh]);
      requestAnimationFrame(() => focusCell(fresh.id, field));
      return;
    }
    focusCell(rows[target]!.id, field);
  }

  // Paste a block copied from Excel or Google Sheets: it fills across and down from the cell you pasted into.
  function onPaste(e: ClipboardEvent<HTMLInputElement>, index: number, field: Field) {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return; // a single value pastes normally
    e.preventDefault();
    let lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'));
    // A header row copied along with the data isn't data.
    if (lines[0] && /^(saree\s*)?(name|design)$/i.test(lines[0][0]?.trim() ?? '')) lines = lines.slice(1);
    if (lines.length === 0) return;
    const startCol = columns.findIndex((c) => c.field === field);
    setRows((rs) => {
      const next = [...rs];
      const size = next.at(-1)?.size || '6.3 m';
      lines.forEach((cellsInLine, k) => {
        while (next.length <= index + k) next.push(blankRow(size, defaultReorder));
        const target = { ...next[index + k]! };
        cellsInLine.forEach((value, j) => {
          const col = columns[startCol + j];
          if (col) target[col.field] = value.trim().replace(/^"|"$/g, '');
        });
        next[index + k] = target;
      });
      return next;
    });
    setErrors({});
    toast.info(`Pasted ${plural(lines.length, 'row')}`);
  }

  // ── What's about to be added ──
  const filled = rows.filter((r) => !isBlank(r));
  const summary = useMemo(() => {
    const names = new Map<string, { isNew: boolean }>();
    let pieces = 0;
    let costValue = 0;
    let saleValue = 0;
    for (const r of filled) {
      const key = norm(r.name);
      if (key && !names.has(key)) names.set(key, { isNew: !existing.has(key) });
      const stock = toCount(r.stock) ?? 0;
      pieces += stock;
      costValue += stock * (toPaise(r.cp) ?? 0);
      saleValue += stock * (toPaise(r.sp) ?? 0);
    }
    const all = [...names.values()];
    return { designsNew: all.filter((n) => n.isNew).length, designsExisting: all.filter((n) => !n.isNew).length, pieces, costValue, saleValue };
  }, [filled, existing]);

  async function save() {
    setTopError(null);
    if (filled.length === 0) return setTopError('Fill in at least one row first.');
    // Catch the plain mistakes here, every one at once, so they can all be fixed in a single pass.
    const local: Record<number, string> = {};
    for (const r of filled) {
      const p = problemsOf(r);
      if (p) local[r.id] = p;
    }
    if (Object.keys(local).length > 0) {
      setErrors(local);
      setTopError(`${plural(Object.keys(local).length, 'row')} need${Object.keys(local).length === 1 ? 's' : ''} fixing before anything is added.`);
      const first = filled.find((r) => local[r.id]);
      if (first) document.getElementById(`sheet-row-${first.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    const payload: BulkSareeRow[] = filled.map((r) => ({
      name: r.name,
      nickname: r.nickname.trim(),
      sku: r.sku,
      color: r.color,
      size: r.size,
      fabric: r.fabric,
      hsn: r.hsn,
      mrpPaise: toPaise(r.mrp)!,
      sellPricePaise: toPaise(r.sp)!,
      costPaise: toPaise(r.cp)!,
      stock: toCount(r.stock)!,
      reorderLevel: toCount(r.reorder) ?? 0,
    }));
    setSaving(true);
    try {
      const result = await api.inventoryBulkAdd(payload);
      if (result.errors.length > 0) {
        setErrors(Object.fromEntries(result.errors.map((e) => [filled[e.row]!.id, e.message])));
        setTopError(`${plural(result.errors.length, 'row')} could not be added, so nothing was added. Fix the marked rows and try again.`);
        document.getElementById(`sheet-row-${filled[result.errors[0]!.row]!.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      refresh();
      const parts = [`${plural(result.variantsCreated, 'piece')} added`];
      if (result.designsCreated) parts.push(`${plural(result.designsCreated, 'new design')}`);
      if (result.designsExtended) parts.push(`${plural(result.designsExtended, 'existing design')} extended`);
      toast.success(parts.join(' · '));
      navigate(paths.inventory());
    } catch (err) {
      setTopError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const saveLabel = filled.length === 0 ? 'Add sarees' : `Add ${plural(filled.length, 'saree')}`;
  const colSpan = columns.length + 2;

  return (
    <>
      <PageHeader
        back={
          <a href={`#${paths.inventory()}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Inventory
          </a>
        }
        title="Add sarees"
        subtitle="One row per piece. Type across, or paste a block straight from Excel."
        actions={
          <Button variant="primary" loading={saving} disabled={filled.length === 0} onClick={() => void save()}>
            {saveLabel}
          </Button>
        }
      />

      {topError && (
        <div className="mb-4">
          <ErrorNote>{topError}</ErrorNote>
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[58rem] table-fixed border-collapse">
          <thead>
            <tr className="border-b border-line bg-canvas/60">
              <th className="w-9 px-2 py-2.5 text-center text-xs font-normal text-ink-muted">#</th>
              {columns.map((c) => (
                <th key={c.field} title={c.title} className={`whitespace-nowrap px-2.5 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-muted ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.width}`}>
                  {c.label}
                  {c.required && <span className="text-status-overdue-fg"> *</span>}
                </th>
              ))}
              <th className="w-[4.25rem]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => {
              const error = errors[r.id];
              const warning = !error ? warningOf(r) : null;
              const key = norm(r.name);
              const match = key ? existing.get(key) : undefined;
              const firstOfName = key ? rows.findIndex((x) => norm(x.name) === key) === index : false;
              return (
                <RowFragment key={r.id}>
                  <tr id={`sheet-row-${r.id}`} className={`group border-b border-line/70 transition-colors ${error ? 'bg-status-overdue-bg/50' : 'hover:bg-canvas/70'}`}>
                    <td className="px-2 text-center align-middle text-xs text-ink-muted">
                      {warning ? (
                        <span title={warning} role="img" aria-label={warning} className="flex justify-center text-status-partial-fg">
                          <AlertTriangle className="h-4 w-4" aria-hidden />
                        </span>
                      ) : (
                        <span className="num">{index + 1}</span>
                      )}
                    </td>
                    {columns.map((c) => (
                      <td key={c.field} className="border-l border-line/50 p-0 align-top">
                        <input
                          ref={(el) => {
                            if (el) cells.current.set(`${r.id}:${c.field}`, el);
                            else cells.current.delete(`${r.id}:${c.field}`);
                          }}
                          value={r[c.field]}
                          onChange={(e) => setCell(r.id, c.field, e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, index, c.field)}
                          onPaste={(e) => onPaste(e, index, c.field)}
                          onFocus={(e) => e.currentTarget.select()}
                          placeholder={c.placeholder}
                          list={c.list}
                          inputMode={c.inputMode}
                          aria-label={`${c.label}, row ${index + 1}`}
                          aria-invalid={!!error && (problemFieldOf(r, error) === c.field || undefined)}
                          className={`h-10 w-full bg-transparent px-2.5 text-sm placeholder:text-ink-muted/40 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand/40 ${c.align === 'right' ? 'num text-right' : ''}`}
                        />
                        {c.field === 'name' && key && (
                          <div className="-mt-1 px-2.5 pb-1.5 text-[11px] leading-none text-ink-muted">
                            {match ? <span className="text-brand">Adds to {match.code}</span> : firstOfName ? 'New saree' : 'Same saree as above'}
                          </div>
                        )}
                      </td>
                    ))}
                    <td className="border-l border-line/50 px-1 align-middle">
                      <div className="flex justify-end gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                        <button type="button" title="Add another colour of this saree" aria-label={`Duplicate row ${index + 1}`} onClick={() => duplicateRow(r.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
                          <Copy className="h-4 w-4" aria-hidden />
                        </button>
                        <button type="button" title="Remove this row" aria-label={`Remove row ${index + 1}`} onClick={() => removeRow(r.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-status-overdue-bg hover:text-status-overdue-fg">
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {error && (
                    <tr className="animate-fade-in border-b border-line/70 bg-status-overdue-bg/50">
                      <td colSpan={colSpan} className="px-4 pb-2 pt-0 text-xs text-status-overdue-fg" role="alert">
                        Row {index + 1}: {error}
                      </td>
                    </tr>
                  )}
                </RowFragment>
              );
            })}
          </tbody>
        </table>

        <datalist id="saree-names">
          {(designs.data ?? []).map((d) => (
            <option key={d.id} value={d.name} />
          ))}
        </datalist>
        <datalist id="saree-colors">
          {COMMON_COLORS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="saree-sizes">
          {COMMON_SIZES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="saree-fabrics">
          {COMMON_FABRICS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => addRows(1)}>
            Add row
          </Button>
          <Button onClick={() => addRows(5)}>Add 5 rows</Button>
          <button type="button" aria-pressed={more} onClick={() => setMore((m) => !m)} className="rounded-lg px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
            {more ? 'Fewer columns' : 'More columns: fabric, HSN, reorder level'}
          </button>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-muted">
            <ClipboardPaste className="h-3.5 w-3.5" aria-hidden /> Copy cells in Excel, click a cell here, paste
          </span>
        </div>
      </Card>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-surface px-6 py-4 shadow-card">
        {filled.length === 0 ? (
          <p className="text-ink-muted">Nothing entered yet. Tab moves across a row, Enter moves down, and the copy button on a row starts the next colour of the same saree.</p>
        ) : (
          <dl className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <dt className="text-xs text-ink-muted">Adding</dt>
              <dd>
                {plural(filled.length, 'piece')} · {plural(summary.designsNew, 'new design')}
                {summary.designsExisting > 0 && `, ${summary.designsExisting} existing`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Opening stock</dt>
              <dd className="num">{plural(summary.pieces, 'piece')}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">At cost / at selling price</dt>
              <dd>
                <Money paise={summary.costValue} fractionDigits={0} /> <span className="text-ink-muted">/</span> <Money paise={summary.saleValue} fractionDigits={0} />
              </dd>
            </div>
          </dl>
        )}
        <Button variant="primary" loading={saving} disabled={filled.length === 0} onClick={() => void save()}>
          {saveLabel}
        </Button>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        All or nothing: if any row has a problem, none are added and you're shown which. MRP is the printed price with GST; SP and CP are before GST.
      </p>
    </>
  );
}

/** Table rows come in pairs (the row, then its error line) and a fragment keeps them together under one key. */
function RowFragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** Which cell an error message is about, so that cell can be marked. */
function problemFieldOf(r: SheetRow, message: string): Field | null {
  if (/special name/i.test(message)) return 'nickname';
  if (/name/i.test(message) && !r.name.trim()) return 'name';
  if (/colour/i.test(message)) return 'color';
  if (/size/i.test(message)) return 'size';
  if (/selling price|SP/.test(message)) return 'sp';
  if (/MRP/.test(message)) return 'mrp';
  if (/CP|cost/i.test(message)) return 'cp';
  if (/stock/i.test(message)) return 'stock';
  if (/reorder/i.test(message)) return 'reorder';
  if (/Saree ID/i.test(message)) return 'sku';
  return null;
}
