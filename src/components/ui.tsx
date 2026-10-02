import { ChevronDown, Loader2, Search } from 'lucide-react';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { formatMoney, moneyToInput, parseMoney } from '../../shared/money';
import { INVOICE_STATUS_LABEL, type InvoiceStatus } from '../../shared/gst';
import { STOCK_STATUS_LABEL, type StockStatus } from '../../shared/stock';
import { PROFORMA_STATUS_LABEL, type InvoiceType, type ProformaStatus } from '../../shared/types';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// ── Buttons ─────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'border border-line bg-surface text-ink hover:border-ink/25 hover:bg-canvas',
  ghost: 'text-ink-muted hover:bg-ink/5 hover:text-ink',
  danger: 'text-status-overdue-fg hover:bg-status-overdue-bg',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
        BUTTON_STYLES[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      type="button"
      title={label}
      aria-label={label}
      className={cx('inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-ink/5 hover:text-ink', className)}
    >
      {children}
    </button>
  );
}

// ── Pills ───────────────────────────────────────────────────────────────────
export type PillTone = 'paid' | 'partial' | 'overdue' | 'b2b' | 'neutral';

const PILL_STYLES: Record<PillTone, string> = {
  paid: 'bg-status-paid-bg text-status-paid-fg',
  partial: 'bg-status-partial-bg text-status-partial-fg',
  overdue: 'bg-status-overdue-bg text-status-overdue-fg',
  b2b: 'bg-status-b2b-bg text-status-b2b-fg',
  neutral: 'bg-status-neutral-bg text-status-neutral-fg',
};

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', PILL_STYLES[tone])}>{children}</span>;
}

const STOCK_TONE: Record<StockStatus, PillTone> = { ok: 'paid', low: 'partial', out: 'overdue', empty: 'neutral' };

export const StockPill = ({ status }: { status: StockStatus }) => <Pill tone={STOCK_TONE[status]}>{STOCK_STATUS_LABEL[status]}</Pill>;

const INVOICE_TONE: Record<InvoiceStatus, PillTone> = { paid: 'paid', partial: 'partial', overdue: 'overdue', unpaid: 'neutral', cancelled: 'neutral' };

export const InvoicePill = ({ status }: { status: InvoiceStatus }) => <Pill tone={INVOICE_TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Pill>;

const PROFORMA_TONE: Record<ProformaStatus, PillTone> = { open: 'partial', expired: 'overdue', partial: 'partial', converted: 'paid', lost: 'overdue', cancelled: 'neutral' };

export const ProformaPill = ({ status }: { status: ProformaStatus }) => <Pill tone={PROFORMA_TONE[status]}>{PROFORMA_STATUS_LABEL[status]}</Pill>;

/** B2B gets the blue tag from the brand palette; B2C stays quiet. */
export const TypePill = ({ type }: { type: InvoiceType }) => <Pill tone={type === 'B2B' ? 'b2b' : 'neutral'}>{type}</Pill>;

// ── Money ───────────────────────────────────────────────────────────────────
/**
 * Rolls a number from its previous value to the new one, so a figure that changes (a payment lands, an invoice is cancelled)
 * visibly moves rather than jumping. Skipped for people who've asked their system for reduced motion.
 */
function useCountUp(target: number, enabled: boolean, duration = 450): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (!enabled || from.current === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const value = Math.round(origin + (target - origin) * (1 - (1 - t) ** 3)); // ease-out
      from.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, enabled, duration]);
  return enabled ? shown : target;
}

export function Money({ paise, fractionDigits = 2, className, animate = false }: { paise: number; fractionDigits?: 0 | 2; className?: string; animate?: boolean }) {
  const shown = useCountUp(paise, animate);
  return <span className={cx('num whitespace-nowrap', className)}>{formatMoney(shown, { fractionDigits })}</span>;
}

/** A whole number that rolls to its new value, like Money does. */
export function Count({ value }: { value: number }) {
  const shown = useCountUp(value, true, 350);
  return <span className="num">{shown}</span>;
}

/** Headline figures roll when their value changes: turns a plain <Money> or number into its animated form. */
export function rolling(node: ReactNode): ReactNode {
  if (isValidElement(node) && node.type === Money) return cloneElement(node as ReactElement<{ animate?: boolean }>, { animate: true });
  if (typeof node === 'number') return <Count value={node} />;
  return node;
}

// ── Form controls ───────────────────────────────────────────────────────────
const CONTROL =
  'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-muted/60 transition-[border-color,box-shadow] duration-150 hover:border-ink/25 focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-canvas disabled:text-ink-muted aria-[invalid=true]:border-status-overdue-fg';

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-status-overdue-fg">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={cx(CONTROL, className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} rows={3} {...rest} className={cx(CONTROL, 'h-auto resize-none py-2', className)} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} {...rest} className={cx(CONTROL, 'appearance-none pr-9', className)}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
    </div>
  );
});

/** A rupee amount field. Holds what's being typed as text, and reports paise. */
export function MoneyInput({ value, onChange, className, ...rest }: { value: number; onChange: (paise: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(() => moneyToInput(value));
  useEffect(() => {
    if ((parseMoney(text) ?? 0) !== value) setText(moneyToInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const invalid = text.trim() !== '' && parseMoney(text) === null;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">₹</span>
      <input
        {...rest}
        inputMode="decimal"
        aria-invalid={invalid}
        value={text}
        placeholder={rest.placeholder ?? '0'}
        onChange={(e) => {
          setText(e.target.value);
          const paise = e.target.value.trim() === '' ? 0 : parseMoney(e.target.value);
          if (paise !== null) onChange(paise);
        }}
        className={cx(CONTROL, 'num pl-7 text-right', className)}
      />
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={cx(CONTROL, 'pl-9')} />
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-sm transition-colors duration-150',
            value === o.value ? 'bg-brand-tint font-medium text-brand' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="num text-xs opacity-70">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Layout pieces ───────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-8">
      {back && <div className="mb-3">{back}</div>}
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 print:hidden">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-lg border border-line bg-surface', className)}>{children}</section>;
}

/**
 * A headline figure. `highlight` marks the one gold accent allowed per screen. Gold is too light to read as
 * text on off-white, so it's a short rule under the figure rather than the figure's colour.
 */
export function Figure({ label, children, sub, highlight }: { label: string; children: ReactNode; sub?: ReactNode; highlight?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl tracking-tight">{rolling(children)}</div>
      <div aria-hidden className={cx('mt-2 h-0.5 w-7 rounded-full', highlight ? 'bg-gold' : 'bg-transparent')} />
      {sub && <div className="mt-1.5 text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, actions }: { icon: ReactNode; title: string; body: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-tint text-brand">{icon}</div>
      <h2 className="text-base">{title}</h2>
      <p className="mt-1 max-w-sm text-ink-muted">{body}</p>
      {actions && <div className="mt-5 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg bg-status-overdue-bg px-3 py-2 text-sm text-status-overdue-fg">
      {children}
    </div>
  );
}

/**
 * What a list looks like while it loads: the shape of the table that's coming, gently pulsing (opacity only — no shimmer
 * gradients), so the page doesn't jump when the rows arrive.
 */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Loading" className="animate-pulse">
      <div className="flex gap-6 border-b border-line px-4 py-3">
        {Array.from({ length: columns }, (_, c) => (
          <div key={c} className="h-3 rounded bg-ink/[0.06]" style={{ width: c === 0 ? '22%' : '12%', marginLeft: c === 0 ? 0 : 'auto' }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-6 border-b border-line/70 px-4 py-4 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className="h-3.5 rounded bg-ink/[0.05]" style={{ width: c === 0 ? `${28 - (r % 3) * 4}%` : '12%', marginLeft: c === 0 ? 0 : 'auto' }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16 text-ink-muted" role="status" aria-label="Loading">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}
