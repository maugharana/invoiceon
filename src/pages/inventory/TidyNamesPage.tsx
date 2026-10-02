import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildDesignName, DEFAULT_OPTIONS, guessChoices } from '../../../shared/nomenclature';
import type { DesignSummary, TidyRow } from '../../../shared/types';
import { ChoiceInput } from '../../components/ChoiceInput';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';

const PAGE = 20;

/** A design is untidy until it has any of the choices: it was named by hand, before saree names were built from choices. */
export const isUntidy = (d: DesignSummary) => !d.weaveStyle && !d.technique && !d.pattern && !d.work;

interface Edit {
  include: boolean;
  keepName: boolean;
  weaveStyle: string;
  fabric: string;
  technique: string;
  pattern: string;
  work: string;
  nickname: string;
}

/** Designs entered before the new naming. Each shows what could be read from its old name; the person fixes or confirms, then applies. */
export function TidyNamesPage() {
  const toast = useToast();
  const refresh = useRefresh();
  const designs = useQuery(() => api.designsList());
  const choices = useQuery(() => api.catalogueOptions());
  const lists = choices.data ?? DEFAULT_OPTIONS;
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [shown, setShown] = useState(PAGE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const untidy = useMemo(() => (designs.data ?? []).filter(isUntidy), [designs.data]);

  const initial = (d: DesignSummary): Edit => {
    const g = guessChoices(d.name, lists);
    // The old short name was often just the technique (Kadhua): once that is its own choice, repeating it as the special name would only
    // say it twice. And a fabric typed in other capitals is the same fabric as the list's.
    const says = [g.weaveStyle, g.technique, g.pattern, ...g.work.split(', ')].some((c) => c && c.toLowerCase() === d.nickname.toLowerCase());
    const fabric = lists.fabric.find((f) => f.toLowerCase() === d.fabric.toLowerCase()) ?? d.fabric;
    return { include: !!(g.weaveStyle || g.technique || g.pattern || g.work), keepName: false, ...g, fabric, nickname: says ? '' : d.nickname };
  };
  const edit = (d: DesignSummary): Edit => edits[d.id] ?? initial(d);
  const patch = (d: DesignSummary, p: Partial<Edit>) => setEdits((e) => ({ ...e, [d.id]: { ...(e[d.id] ?? initial(d)), ...p } }));
  const builtName = (e: Edit) => buildDesignName({ weaveStyle: e.weaveStyle, fabric: e.fabric, technique: e.technique, pattern: e.pattern, work: e.work, specialName: e.nickname });
  const hasChoice = (e: Edit) => !!(e.weaveStyle || e.technique || e.pattern || e.work);

  const chosen = untidy.filter((d) => edit(d).include && hasChoice(edit(d)));

  async function apply() {
    setSaving(true);
    setError(null);
    const rows: TidyRow[] = chosen.map((d) => {
      const e = edit(d);
      return { id: d.id, weaveStyle: e.weaveStyle, fabric: e.fabric, technique: e.technique, pattern: e.pattern, work: e.work, nickname: e.nickname.trim(), rename: !e.keepName };
    });
    try {
      const r = await api.designsTidy(rows);
      refresh();
      setEdits({});
      toast.success(`${plural(r.updated, 'design')} updated${r.renamed ? `, ${r.renamed} renamed` : ''}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const back = (
    <a href={`#${paths.inventory()}`} className="inline-flex items-center gap-1.5 rounded-lg text-ink-muted transition-colors hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Inventory
    </a>
  );

  return (
    <>
      <PageHeader
        back={back}
        title="Fix names"
        subtitle="These designs were named by hand. Pick their choices and each one is renamed the same way as every new saree. What could be read from the old name is filled in for you."
        actions={
          <Button variant="primary" loading={saving} disabled={chosen.length === 0} onClick={() => void apply()}>
            {chosen.length === 0 ? 'Update designs' : `Update ${plural(chosen.length, 'design')}`}
          </Button>
        }
      />
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {designs.error && <ErrorNote>{designs.error}</ErrorNote>}

      {!designs.loading && untidy.length === 0 ? (
        <Card>
          <EmptyState icon={<span aria-hidden>✓</span>} title="Every design has its choices" body="New sarees are named from their choices as you add them, so there is nothing to fix here." actions={<Button onClick={() => navigate(paths.inventory())}>Back to inventory</Button>} />
        </Card>
      ) : (
        <div className="space-y-4">
          {untidy.slice(0, shown).map((d) => {
            const e = edit(d);
            const built = builtName(e);
            const willRename = e.include && hasChoice(e) && !e.keepName && built !== '' && built !== d.name;
            return (
              <Card key={d.id} className={`p-5 transition-opacity ${e.include ? '' : 'opacity-60'}`}>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <span className="num mr-2 text-xs text-ink-muted">{d.code}</span>
                    <span className="font-medium">{d.name}</span>
                    <span className="ml-2 text-xs text-ink-muted">{plural(d.variantCount, 'colour and size', 'colours and sizes')}</span>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={e.include} onChange={(ev) => patch(d, { include: ev.target.checked })} className="h-4 w-4 accent-[#0F6E56]" />
                    Update this design
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Weave style">
                    <ChoiceInput options={lists.weaveStyle} value={e.weaveStyle} onChange={(v) => patch(d, { weaveStyle: v, include: true })} placeholder="Banarasi…" aria-label={`Weave style, ${d.code}`} />
                  </Field>
                  <Field label="Fabric">
                    <ChoiceInput options={lists.fabric} value={e.fabric} onChange={(v) => patch(d, { fabric: v })} placeholder="Katan Silk…" aria-label={`Fabric, ${d.code}`} />
                  </Field>
                  <Field label="Technique">
                    <ChoiceInput options={lists.technique} value={e.technique} onChange={(v) => patch(d, { technique: v, include: true })} placeholder="Kadhua…" aria-label={`Technique, ${d.code}`} />
                  </Field>
                  <Field label="Pattern">
                    <ChoiceInput options={lists.pattern} value={e.pattern} onChange={(v) => patch(d, { pattern: v, include: true })} placeholder="Butidar, Jaal…" aria-label={`Pattern, ${d.code}`} />
                  </Field>
                  <Field label="Special work">
                    <ChoiceInput multi options={lists.work} value={e.work} onChange={(v) => patch(d, { work: v, include: true })} placeholder="Zardozi…" aria-label={`Special work, ${d.code}`} />
                  </Field>
                  <Field label="Special name">
                    <Input value={e.nickname} onChange={(ev) => patch(d, { nickname: ev.target.value })} maxLength={40} placeholder="Lalima" aria-label={`Special name, ${d.code}`} />
                  </Field>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-canvas px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="text-xs text-ink-muted">{e.keepName ? 'Name stays' : 'New name'}</span>
                    <div className="truncate">{e.keepName ? d.name : built || <span className="text-ink-muted">Pick a weave style, technique, pattern or work to build a name.</span>}</div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-ink-muted">
                    <input type="checkbox" checked={e.keepName} onChange={(ev) => patch(d, { keepName: ev.target.checked })} className="h-4 w-4 accent-[#0F6E56]" />
                    Keep the current name, only save the choices
                  </label>
                </div>
                {willRename && <p className="mt-1.5 text-xs text-ink-muted">Invoices already issued keep the name they were issued with.</p>}
              </Card>
            );
          })}
          {untidy.length > shown && (
            <div className="text-center">
              <Button onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, untidy.length - shown)} more ({untidy.length - shown} left)</Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
