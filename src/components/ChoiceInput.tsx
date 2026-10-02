import { Check, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { splitWorks } from '../../shared/nomenclature';
import { matchesAll } from '../../shared/search';

interface Props {
  options: readonly string[];
  /** The chosen value. With `multi` it is the choices joined by commas. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Pick several (the work done on a saree can be more than one). */
  multi?: boolean;
  /** Lets a choice that isn't in the list be added by typing it. On by default. */
  allowNew?: boolean;
  'aria-label'?: string;
  autoFocus?: boolean;
}

/** A pick list that can be typed into to narrow it, and that offers to add what is typed when it isn't there. */
export function ChoiceInput({ options, value, onChange, placeholder, multi = false, allowNew = true, autoFocus, ...rest }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const chosen = useMemo(() => (multi ? splitWorks(value) : value ? [value] : []), [multi, value]);
  const typed = q.replace(/\s+/g, ' ').trim();
  const results = useMemo(() => options.filter((o) => matchesAll(o, typed)).slice(0, 60), [options, typed]);
  const canAdd = allowNew && typed !== '' && !options.some((o) => o.toLowerCase() === typed.toLowerCase());
  const rows = canAdd ? [...results, typed] : results;
  const isChosen = (o: string) => chosen.some((c) => c.toLowerCase() === o.toLowerCase());

  function choose(option: string) {
    if (multi) {
      const next = isChosen(option) ? chosen.filter((c) => c.toLowerCase() !== option.toLowerCase()) : [...chosen, option];
      onChange(next.join(', '));
    } else {
      onChange(option);
      setOpen(false);
    }
    setQ('');
    setActive(0);
  }

  const remove = (o: string) => onChange(chosen.filter((c) => c !== o).join(', '));

  return (
    // Inside a <label> (every Field is one), a click on a list entry that has just been replaced would be passed on to the label's first
    // button, which here is a chip's remove button. Cancelling the click's default stops that.
    <div className="relative" onClick={(e) => e.preventDefault()}>
      {multi && chosen.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {chosen.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-lg bg-brand-tint px-2 py-1 text-xs text-brand">
              {c}
              <button type="button" aria-label={`Remove ${c}`} onClick={() => remove(c)} className="rounded hover:bg-brand/10">
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        {...rest}
        role="combobox"
        aria-expanded={open}
        autoFocus={autoFocus}
        autoComplete="off"
        value={open || multi ? q : value}
        placeholder={multi && chosen.length > 0 ? 'Add another' : placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQ('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, rows.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && rows[active]) {
            e.preventDefault();
            choose(rows[active]!);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === 'Backspace' && multi && q === '' && chosen.length > 0) remove(chosen.at(-1)!);
        }}
        className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-muted/60 hover:border-ink/25 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
      />
      {open && rows.length > 0 && (
        <ul role="listbox" onMouseDown={(e) => e.preventDefault()} className="animate-pop-in absolute z-30 mt-1.5 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-overlay">
          {rows.map((o, i) => {
            const isNew = canAdd && i === rows.length - 1;
            return (
              <li key={`${i}-${o}`} role="option" aria-selected={isChosen(o)}>
                <button type="button" onClick={() => choose(o)} onMouseEnter={() => setActive(i)} className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left ${isNew ? 'border-t border-line text-brand' : ''} ${i === active ? 'bg-brand-tint' : ''}`}>
                  <span className="flex items-center gap-2">
                    {isNew && <Plus className="h-4 w-4" aria-hidden />}
                    {isNew ? `Add “${o}”` : o}
                  </span>
                  {isChosen(o) && <Check className="h-4 w-4 text-brand" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
