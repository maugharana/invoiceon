/** True when every word in the query appears somewhere in the text, in any order ("butidar maroon" finds "Mau Silk Butidar · Maroon"). */
export function matchesAll(text: string, query: string | undefined): boolean {
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = text.toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** The number of single letter changes (add, remove or swap one) it takes to turn one text into the other. */
export function editDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[y.length]!;
}

/**
 * The choices a typed text is probably a slip for ("Kadhwa" for "Kadhua"): within one letter for short texts, two for longer ones. The
 * exact text, in any capitals, is not a slip. Nearest first, at most three.
 */
export function closeMatches(text: string, options: readonly string[]): string[] {
  const t = text.trim();
  if (t.length < 4) return [];
  const limit = t.length <= 5 ? 1 : 2;
  return options
    .map((o) => ({ o, d: editDistance(t, o) }))
    .filter(({ o, d }) => d > 0 && d <= limit && o.toLowerCase() !== t.toLowerCase())
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(({ o }) => o);
}
