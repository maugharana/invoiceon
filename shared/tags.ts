/** Tags are stored as one comma separated string ("bridal, silk, regular") and shown as chips. */

const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;

/** Splits and tidies a tag string: trimmed, no empties, no repeats (ignoring case), each kept short. */
export function parseTags(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of String(text ?? '').split(/[,;\n]/)) {
    const tag = part.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/** The form stored in the database. */
export function normalizeTags(text: string | null | undefined): string {
  return parseTags(text).join(', ');
}

/** Every tag in use across some records, most used first (then alphabetical), for suggestions and filters. */
export function tagCounts(tagStrings: Iterable<string | null | undefined>): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const s of tagStrings) {
    for (const tag of parseTags(s)) {
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** True if the record carries the tag (ignoring case). An empty tag matches everything. */
export function hasTag(tagString: string | null | undefined, tag: string): boolean {
  if (!tag) return true;
  const key = tag.toLowerCase();
  return parseTags(tagString).some((t) => t.toLowerCase() === key);
}
