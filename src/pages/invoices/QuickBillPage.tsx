import { Minus, Plus, Printer, ScanLine, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeInvoice, resolveRate, todayIso } from '../../../shared/gst';
import { formatMoney, mulPaise } from '../../../shared/money';
import { matchesAll } from '../../../shared/search';
import { PAYMENT_METHOD_LABEL, type Invoice, type PaymentMethod, type SaleVariant } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Money, MoneyInput, PageHeader, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { navigate, paths } from '../../lib/router';

interface Line {
  variantId: string;
  qty: number;
  price: number;
}

const PAY: PaymentMethod[] = ['cash', 'upi', 'card'];

/**
 * The counter screen: scan a saree (or type a bit of its name), see the total, press how the customer paid. One walk-in bill,
 * paid in full, issued in a single step. For a named customer, discounts on items, or part payment, use the full invoice screen.
 */
export function QuickBillPage() {
  const toast = useToast();
  const refresh = useRefresh();
  const variants = useQuery(() => api.variantsForSale());
  const settings = useQuery(() => api.getSettings());
  const box = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<PaymentMethod | null>(null);
  const [done, setDone] = useState<Invoice | null>(null);

  const byId = useMemo(() => new Map((variants.data ?? []).map((v) => [v.variantId, v])), [variants.data]);
  const results = useMemo(() => (q.trim() ? (variants.data ?? []).filter((v) => matchesAll(`${v.designName} ${v.designNickname} ${v.designCode} ${v.color} ${v.size} ${v.sku} ${v.barcode}`, q)).slice(0, 8) : []), [variants.data, q]);

  useEffect(() => {
    if (!done) box.current?.focus();
  }, [done, variants.data, settings.data]);

  function add(v: SaleVariant) {
    setError(null);
    setNote(null);
    const have = lines.find((l) => l.variantId === v.variantId)?.qty ?? 0;
    if (have + 1 > v.stock) {
      setError(v.stock <= 0 ? `${v.designName} (${v.color}, ${v.size}) is out of stock.` : `Only ${v.stock} of ${v.designName} (${v.color}, ${v.size}) in stock.`);
      return;
    }
    setLines((ls) => (ls.some((l) => l.variantId === v.variantId) ? ls.map((l) => (l.variantId === v.variantId ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { variantId: v.variantId, qty: 1, price: v.sellPricePaise }]));
    setNote(`Added ${v.designName}, ${v.color} ${v.size}`);
  }

  // A scanner types the code and presses Enter; so does a person who has finished typing a name.
  function submitBox() {
    const code = q.trim().toLowerCase();
    if (!code) return;
    const exact = (variants.data ?? []).find((v) => v.sku.toLowerCase() === code || (v.barcode !== '' && v.barcode.toLowerCase() === code));
    const hit = exact ?? (results.length === 1 ? results[0] : undefined);
    if (hit) {
      add(hit);
      setQ('');
    } else if (results.length === 0) setError(`Nothing matches “${q.trim()}”.`);
    else setError('Several sarees match. Click the one you want, or type a little more.');
  }

  const shop = { gstRatePercent: settings.data?.gstRatePercent ?? 0, rateSlabs: settings.data?.rateSlabs ?? [] };
  const priced = lines.map((l) => {
    const v = byId.get(l.variantId);
    const amount = mulPaise(l.qty, l.price);
    return { l, v, amount, rate: resolveRate({ designRate: v?.gstRatePercent ?? null, qty: l.qty, netPaise: amount }, shop) };
  });
  const totals = computeInvoice({
    lines: priced.map((p) => ({ amountPaise: p.amount, ratePercent: p.rate })),
    discountPaise: Math.min(discount, priced.reduce((s, p) => s + p.amount, 0)),
    intraState: true,
    inclusive: settings.data?.pricesIncludeGst ?? false,
    roundOff: settings.data?.roundOff,
  });

  async function charge(method: PaymentMethod) {
    if (lines.length === 0 || saving) return;
    setSaving(method);
    setError(null);
    try {
      const inv = await api.invoiceCreate({
        type: 'B2C',
        customerId: null,
        issueDate: todayIso(),
        dueDate: todayIso(),
        discountPaise: Math.min(discount, totals.subtotalPaise),
        notes: '',
        lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPricePaise: l.price })),
        payment: { amountPaise: totals.totalPaise, method, reference: '' },
      });
      refresh();
      setDone(inv);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  function again() {
    setDone(null);
    setLines([]);
    setDiscount(0);
    setQ('');
    setError(null);
    setNote(null);
  }

  // Keyboard for the counter: Ctrl+Enter takes cash, and Esc empties the box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) {
        if (e.key === 'Enter') again();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void charge('cash');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const back = (
    <a href={`#${paths.invoices()}`} className="text-ink-muted transition-colors hover:text-ink">
      ← Invoices
    </a>
  );

  if (variants.error) return <ErrorNote>{variants.error}</ErrorNote>;
  if (!variants.data || !settings.data) return <Spinner />;

  if (done) {
    return (
      <>
        <PageHeader title="Quick bill" back={back} />
        <Card className="mx-auto max-w-lg p-8 text-center">
          <div className="text-xs font-medium text-ink-muted">Bill paid</div>
          <div className="num mt-1 text-3xl tracking-tight">
            <Money paise={done.totalPaise} fractionDigits={0} />
          </div>
          <div aria-hidden className="mx-auto mt-2 h-0.5 w-8 rounded-full bg-gold" />
          <p className="mt-3 text-ink-muted">
            Invoice <a href={`#${paths.invoice(done.id)}`} className="num text-ink hover:text-brand">{done.number}</a> issued, stock updated.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button
              icon={<Printer className="h-4 w-4" />}
              onClick={async () => {
                try {
                  if (window.invoiceon) await api.invoicePrint(done.id);
                  else window.open(`${location.origin}${location.pathname}#/print/invoice/${encodeURIComponent(done.id)}`, '_blank');
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              Print invoice
            </Button>
            <Button
              onClick={async () => {
                try {
                  if (window.invoiceon) await api.invoiceSlipPrint(done.id);
                  else window.open(`${location.origin}${location.pathname}#${paths.printSlip(done.id)}`, '_blank');
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              Print receipt
            </Button>
            <Button variant="primary" onClick={again} data-autofocus>
              Next customer
            </Button>
          </div>
          <p className="mt-3 text-xs text-ink-muted">Press Enter for the next customer.</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Quick bill"
        subtitle="Scan or type a saree, then press how the customer paid."
        back={back}
        actions={
          <Button onClick={() => navigate(paths.newInvoice())} title="For a named customer, item discounts or part payment">
            Full invoice screen
          </Button>
        }
      />
      <div className="grid grid-cols-[1fr_20rem] gap-6">
        <div className="space-y-4">
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden />
            <input
              ref={box}
              value={q}
              aria-label="Scan a barcode or search for a saree"
              placeholder="Scan the barcode, or type a name, colour or code"
              autoComplete="off"
              onChange={(e) => {
                setQ(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submitBox();
                } else if (e.key === 'Escape') setQ('');
              }}
              className="h-12 w-full rounded-lg border border-line bg-surface pl-12 pr-4 text-base transition-[border-color,box-shadow] duration-150 placeholder:text-ink-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
            />
            {results.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-overlay">
                {results.map((v) => (
                  <li key={v.variantId}>
                    <button
                      type="button"
                      disabled={v.stock <= 0}
                      onClick={() => {
                        add(v);
                        setQ('');
                        box.current?.focus();
                      }}
                      className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors hover:bg-brand-tint disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{v.designName}</span>
                        <span className="block text-xs text-ink-muted">{v.color} · {v.size} · {v.stock <= 0 ? 'out of stock' : `${v.stock} in stock`}</span>
                      </span>
                      <span className="num">{formatMoney(v.sellPricePaise, { fractionDigits: 0 })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          {note && !error && <p className="text-xs text-status-paid-fg" role="status">{note}</p>}

          <Card className="overflow-hidden">
            {lines.length === 0 ? (
              <p className="px-6 py-12 text-center text-ink-muted">Nothing on this bill yet. Scan a saree to begin.</p>
            ) : (
              <ul className="divide-y divide-line/70">
                {priced.map(({ l, v, amount }) => (
                  <li key={l.variantId} className="animate-fade-in flex items-center gap-4 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{v?.designName}</div>
                      <div className="text-xs text-ink-muted">{v?.color} · {v?.size} · <span className="num">{formatMoney(l.price, { fractionDigits: 0 })}</span> each</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="One less" onClick={() => setLines((ls) => (l.qty <= 1 ? ls.filter((x) => x !== l) : ls.map((x) => (x === l ? { ...x, qty: x.qty - 1 } : x))))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line transition-colors hover:bg-canvas">
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="num w-8 text-center">{l.qty}</span>
                      <button type="button" aria-label="One more" onClick={() => v && add(v)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line transition-colors hover:bg-canvas">
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="w-24 text-right"><Money paise={amount} fractionDigits={0} /></div>
                    <button type="button" aria-label={`Remove ${v?.designName}`} onClick={() => setLines((ls) => ls.filter((x) => x !== l))} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside>
          <Card className="sticky top-6 p-6">
            <dl className="space-y-2">
              <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd><Money paise={totals.subtotalPaise} /></dd></div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">Discount</dt>
                <dd className="w-28"><MoneyInput value={discount} onChange={setDiscount} aria-label="Discount" className="h-8" /></dd>
              </div>
              {totals.taxPaise > 0 && <div className="flex justify-between"><dt className="text-ink-muted">GST</dt><dd><Money paise={totals.taxPaise} /></dd></div>}
              {totals.roundOffPaise !== 0 && <div className="flex justify-between text-ink-muted"><dt>Round off</dt><dd className="num">{totals.roundOffPaise < 0 ? '−' : '+'}{formatMoney(Math.abs(totals.roundOffPaise))}</dd></div>}
            </dl>
            <div className="mt-4 border-t border-line pt-4">
              <div className="text-xs text-ink-muted">To pay</div>
              <div key={totals.totalPaise} className="animate-tick num text-4xl tracking-tight">
                <Money paise={totals.totalPaise} fractionDigits={0} />
              </div>
              <div aria-hidden className="mt-2 h-0.5 w-8 rounded-full bg-gold" />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {PAY.map((m) => (
                <Button key={m} variant={m === 'cash' ? 'primary' : 'secondary'} disabled={lines.length === 0 || !!saving} loading={saving === m} onClick={() => void charge(m)} className="h-11">
                  {PAYMENT_METHOD_LABEL[m]}
                </Button>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-muted">Ctrl+Enter takes cash. The bill is issued as a walk-in sale, paid in full.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}
