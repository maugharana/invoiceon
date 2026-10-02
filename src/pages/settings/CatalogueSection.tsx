import { Check, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { CatalogueEntry } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { ErrorNote, IconButton, Input, Pill, Segmented } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';

const KINDS: { value: CatalogueEntry['kind']; label: string; one: string }[] = [
  { value: 'weaveStyle', label: 'Weave style', one: 'weave style' },
  { value: 'fabric', label: 'Fabric', one: 'fabric' },
  { value: 'technique', label: 'Technique', one: 'technique' },
  { value: 'pattern', label: 'Pattern', one: 'pattern' },
  { value: 'work', label: 'Special work', one: 'work' },
  { value: 'colour', label: 'Colour', one: 'colour' },
];

/** The pick lists used when entering a saree: fix a typo everywhere, merge two spellings, or remove a choice nobody uses. */
export function CatalogueSection() {
  const toast = useToast();
  const refresh = useRefresh();
  const entries = useQuery(() => api.catalogueEntries());
  const [kind, setKind] = useState<CatalogueEntry['kind']>('weaveStyle');
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const info = KINDS.find((k) => k.value === kind)!;
  const all = (entries.data ?? []).filter((e) => e.kind === kind);
  const yours = all.filter((e) => !e.builtIn);
  const builtIn = all.filter((e) => e.builtIn);
  const usesWord = kind === 'colour' ? 'piece' : 'design';

  function startEdit(e: CatalogueEntry) {
    setEditing(e.label);
    setText(e.label);
    setError(null);
  }

  async function rename(e: CatalogueEntry) {
    const to = text.trim().replace(/\s+/g, ' ');
    if (!to || to === e.label) return setEditing(null);
    setBusy(true);
    setError(null);
    try {
      const { changed } = await api.catalogueRename({ kind, from: e.label, to });
      refresh();
      toast.success(changed > 0 ? `“${e.label}” is now “${to}” on ${plural(changed, usesWord)}` : `“${e.label}” is now “${to}”`);
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: CatalogueEntry) {
    setBusy(true);
    setError(null);
    try {
      await api.catalogueDelete({ kind, label: e.label });
      refresh();
      toast.success(`“${e.label}” removed`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const target = editing ? all.find((o) => o.label.toLowerCase() === text.trim().toLowerCase() && o.label !== editing) : undefined;

  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-canvas px-3 py-2 text-ink-muted">
        These are the choices offered when you add a saree. Choices you typed yourself can be renamed, which changes every saree that uses them, and a saree whose name was built from its choices is renamed too. Renaming one to a choice that already exists merges the two. The starting choices every shop gets can't be changed.
      </p>

      <Segmented label="Kind of choice" value={kind} onChange={(k) => { setKind(k); setEditing(null); setError(null); }} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />

      {error && <ErrorNote>{error}</ErrorNote>}

      <section aria-label={`Your ${info.one} choices`}>
        <h3 className="mb-2 text-sm font-medium">Added by you</h3>
        {entries.loading ? (
          <p className="text-ink-muted">Loading…</p>
        ) : yours.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-3 text-ink-muted">Nothing yet. A {info.one} you type while entering a saree is kept here.</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-line">
            {yours.map((e) => (
              <li key={e.label} className="flex flex-wrap items-center gap-2 border-b border-line/70 px-3 py-2 last:border-0">
                {editing === e.label ? (
                  <>
                    <Input value={text} onChange={(ev) => setText(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void rename(e); } else if (ev.key === 'Escape') setEditing(null); }} aria-label={`New name for ${e.label}`} className="max-w-xs" maxLength={60} autoFocus />
                    <IconButton label="Save the new name" onClick={() => void rename(e)} disabled={busy}>
                      <Check className="h-4 w-4" aria-hidden />
                    </IconButton>
                    <IconButton label="Cancel" onClick={() => setEditing(null)}>
                      <X className="h-4 w-4" aria-hidden />
                    </IconButton>
                    {target && <span className="text-xs text-brand">This merges into the existing “{target.label}”.</span>}
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate">{e.label}</span>
                    <span className="num text-xs text-ink-muted">{e.uses === 0 ? 'Not used' : `Used by ${plural(e.uses, usesWord)}`}</span>
                    <IconButton label={`Rename ${e.label}`} onClick={() => startEdit(e)} disabled={busy}>
                      <Pencil className="h-4 w-4" aria-hidden />
                    </IconButton>
                    {e.uses === 0 && (
                      <IconButton label={`Remove ${e.label}`} onClick={() => void remove(e)} disabled={busy}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </IconButton>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="rounded-lg border border-line">
        <summary className="cursor-pointer px-3 py-2 text-sm">Starting choices ({builtIn.length})</summary>
        <ul className="flex flex-wrap gap-2 border-t border-line px-3 py-3">
          {builtIn.map((e) => (
            <li key={e.label}>
              <Pill tone={e.uses > 0 ? 'paid' : 'neutral'}>
                {e.label}
                {e.uses > 0 && <span className="num ml-1.5 opacity-70">{e.uses}</span>}
              </Pill>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
