import type { Settings } from '../../../shared/types';
import { toNumber } from '../../lib/format';

/** Number fields are edited as text so half-typed values like "2." don't fight the input. */
const NUMERIC = ['gstRatePercent', 'defaultDueDays', 'defaultReorderLevel', 'proformaValidDays'] as const;
type NumericKey = (typeof NUMERIC)[number];

export type Draft = Omit<Settings, NumericKey> & Record<NumericKey, string>;

export type SetDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => void;

/** What every settings section receives: the shared draft and a way to change one field of it. */
export interface SectionProps {
  draft: Draft;
  set: SetDraft;
}

export const toDraft = (s: Settings): Draft => {
  const d = { ...s } as Record<string, unknown>;
  for (const k of NUMERIC) d[k] = String(s[k]);
  return d as unknown as Draft;
};

/** Back to real numbers, for saving and for the live invoice preview. `strict` throws on a number that isn't one. */
export function fromDraft(draft: Draft, strict = false): Settings {
  const out = { ...draft } as Record<string, unknown>;
  for (const k of NUMERIC) {
    const n = toNumber(draft[k]);
    if (Number.isNaN(n) && strict) throw new Error('GST rate, payment terms, reorder level and proforma validity must be numbers.');
    out[k] = Number.isNaN(n) ? 0 : n;
  }
  return out as unknown as Settings;
}
