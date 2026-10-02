import { buildDesignName, CATALOGUE_KINDS, DEFAULT_OPTIONS, splitWorks } from '../../shared/nomenclature';
import type { CatalogueEntry, TidyResult, TidyRow } from '../../shared/types';
import { all, run, tx, type Db } from '../db/connection';
import { UserError, isUniqueViolation, nowIso } from './common';
import { catalogueOptions, getDesign, rememberOption, updateDesign } from './inventory';

type Kind = CatalogueEntry['kind'];

/** The column on `designs` that holds each kind of choice. Colours live on the pieces instead. */
const DESIGN_COLUMN = { weaveStyle: 'weave_style', fabric: 'fabric', technique: 'technique', pattern: 'pattern', work: 'work' } as const;

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function requireKind(kind: unknown): Kind {
  if (!(CATALOGUE_KINDS as readonly unknown[]).includes(kind)) throw new UserError('That kind of choice is not recognised.');
  return kind as Kind;
}

const isBuiltIn = (kind: Kind, label: string) => DEFAULT_OPTIONS[kind].some((o) => same(o, label));

/** How many designs use each choice, by lower case label. For colours it counts pieces. */
function usesOf(db: Db, kind: Kind): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (label: string) => counts.set(label.toLowerCase(), (counts.get(label.toLowerCase()) ?? 0) + 1);
  if (kind === 'colour') {
    for (const r of all<{ v: string }>(db, "SELECT color AS v FROM variants WHERE deleted_at IS NULL AND color <> ''")) bump(r.v);
  } else if (kind === 'work') {
    for (const r of all<{ v: string }>(db, "SELECT work AS v FROM designs WHERE deleted_at IS NULL AND work <> ''")) splitWorks(r.v).forEach(bump);
  } else {
    const col = DESIGN_COLUMN[kind];
    for (const r of all<{ v: string }>(db, `SELECT ${col} AS v FROM designs WHERE deleted_at IS NULL AND ${col} <> ''`)) bump(r.v);
  }
  return counts;
}

export function catalogueEntries(db: Db): CatalogueEntry[] {
  const options = catalogueOptions(db);
  return CATALOGUE_KINDS.flatMap((kind) => {
    const uses = usesOf(db, kind);
    return options[kind].map((label) => ({ kind, label, builtIn: isBuiltIn(kind, label), uses: uses.get(label.toLowerCase()) ?? 0 }));
  });
}

/**
 * Renames a choice wherever it is used. A design whose name was built from its choices is renamed to the name the new choices build;
 * one named by hand keeps its name. Renaming to a choice that already exists merges the two.
 */
export function renameChoice(db: Db, input: { kind: Kind; from: string; to: string }): { changed: number } {
  const kind = requireKind(input.kind);
  const from = clean(input.from);
  const to = clean(input.to);
  if (!from) throw new UserError('Choose the choice to rename.');
  if (!to) throw new UserError('Type the new name.');
  if (to.length > 60) throw new UserError('The new name is too long (max 60 characters).');
  if (kind === 'work' && to.includes(',')) throw new UserError('A work\'s name can\'t contain a comma.');
  if (isBuiltIn(kind, from)) throw new UserError(`"${from}" is one of the choices every shop starts with, so it can't be renamed.`);

  return tx(db, () => {
    let changed = 0;
    if (kind === 'colour') {
      changed = usesOf(db, 'colour').get(from.toLowerCase()) ?? 0;
      try {
        run(db, 'UPDATE variants SET color = ?, updated_at = ? WHERE color = ? COLLATE NOCASE AND deleted_at IS NULL', to, nowIso(), from);
      } catch (err) {
        if (isUniqueViolation(err)) throw new UserError(`Some designs already have both "${from}" and "${to}" in the same size, so they can't be merged. Change those pieces first.`);
        throw err;
      }
    } else {
      const col = DESIGN_COLUMN[kind];
      const rows = all<{ id: string; name: string; nickname: string; fabric: string; weave_style: string; technique: string; pattern: string; work: string }>(
        db,
        'SELECT id, name, nickname, fabric, weave_style, technique, pattern, work FROM designs WHERE deleted_at IS NULL',
      );
      for (const d of rows) {
        const parts = { weaveStyle: d.weave_style, fabric: d.fabric, technique: d.technique, pattern: d.pattern, work: d.work, specialName: d.nickname };
        let after: string;
        if (kind === 'work') {
          const list = splitWorks(d.work);
          if (!list.some((w) => same(w, from))) continue;
          after = splitWorks(list.map((w) => (same(w, from) ? to : w)).join(', ')).join(', ');
        } else {
          if (!same(d[col], from)) continue;
          after = to;
        }
        const next = { ...parts, [kind]: after };
        // Renamed along with its choices only if its name was the one those choices built.
        const name = d.name === buildDesignName(parts) && buildDesignName(next) ? buildDesignName(next) : d.name;
        run(db, `UPDATE designs SET ${col} = ?, name = ?, updated_at = ? WHERE id = ?`, after, name, nowIso(), d.id);
        changed += 1;
      }
    }
    run(db, 'DELETE FROM catalogue_options WHERE kind = ? AND label = ? COLLATE NOCASE', kind, from);
    rememberOption(db, kind, to);
    return { changed };
  });
}

export function deleteChoice(db: Db, input: { kind: Kind; label: string }): void {
  const kind = requireKind(input.kind);
  const label = clean(input.label);
  if (isBuiltIn(kind, label)) throw new UserError(`"${label}" is one of the choices every shop starts with, so it can't be removed.`);
  const used = usesOf(db, kind).get(label.toLowerCase()) ?? 0;
  if (used > 0) throw new UserError(`${used} ${kind === 'colour' ? (used === 1 ? 'piece uses' : 'pieces use') : used === 1 ? 'design uses' : 'designs use'} "${label}". Rename it to another choice instead, which merges them.`);
  run(db, 'DELETE FROM catalogue_options WHERE kind = ? AND label = ? COLLATE NOCASE', kind, label);
}

/**
 * Sets the choices on designs that were named by hand and, where asked, renames each to the name the choices build. Each design goes
 * through the same checks as editing it, and nothing is saved unless all of them pass.
 */
export function tidyDesigns(db: Db, rows: TidyRow[]): TidyResult {
  if (!Array.isArray(rows) || rows.length === 0) throw new UserError('Choose at least one design.');
  if (rows.length > 500) throw new UserError('Tidy up to 500 designs at a time.');
  return tx(db, () => {
    let renamed = 0;
    for (const r of rows) {
      const d = getDesign(db, r.id);
      const built = buildDesignName({ weaveStyle: r.weaveStyle, fabric: r.fabric, technique: r.technique, pattern: r.pattern, work: r.work, specialName: r.nickname });
      const rename = !!r.rename && built !== '';
      try {
        updateDesign(db, d.id, {
          code: d.code,
          name: rename ? built : d.name,
          nickname: r.nickname,
          fabric: r.fabric,
          weaveStyle: r.weaveStyle,
          technique: r.technique,
          pattern: r.pattern,
          work: r.work,
          hsnCode: d.hsnCode,
          description: d.description,
          defaultPricePaise: d.defaultPricePaise,
          gstRatePercent: d.gstRatePercent,
          tags: d.tags,
          supplierId: d.supplierId,
        });
      } catch (err) {
        if (err instanceof UserError) throw new UserError(`${d.code}: ${err.message}`);
        throw err;
      }
      if (rename && built !== d.name) renamed += 1;
    }
    return { updated: rows.length, renamed };
  });
}
