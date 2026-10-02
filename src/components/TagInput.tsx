import { parseTags } from '../../shared/tags';
import { Input } from './ui';

/** Small grey chips for showing tags on a row or a page. */
export function TagChips({ tags, onClick }: { tags: string | string[]; onClick?: (tag: string) => void }) {
  const list = Array.isArray(tags) ? tags : parseTags(tags);
  if (list.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.map((t) =>
        onClick ? (
          <button key={t} type="button" onClick={() => onClick(t)} className="rounded-md bg-canvas px-1.5 py-0.5 text-xs text-ink-muted transition-colors hover:bg-brand-tint hover:text-brand">
            {t}
          </button>
        ) : (
          <span key={t} className="rounded-md bg-canvas px-1.5 py-0.5 text-xs text-ink-muted">
            {t}
          </span>
        ),
      )}
    </span>
  );
}

/** A text field for comma separated tags, with the tags already used elsewhere offered as one-tap suggestions. */
export function TagInput({ value, onChange, suggestions = [], placeholder }: { value: string; onChange: (v: string) => void; suggestions?: string[]; placeholder?: string }) {
  const have = new Set(parseTags(value).map((t) => t.toLowerCase()));
  const offer = suggestions.filter((s) => !have.has(s.toLowerCase())).slice(0, 8);
  return (
    <div className="space-y-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'bridal, regular, wholesale'} />
      {offer.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          <span>Used before:</span>
          {offer.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange([...parseTags(value), s].join(', '))}
              className="rounded-md border border-line px-1.5 py-0.5 transition-colors hover:border-brand hover:text-brand"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
