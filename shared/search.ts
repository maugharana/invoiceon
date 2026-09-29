/** True when every word in the query appears somewhere in the text, in any order ("butidar maroon" finds "Mau Silk Butidar · Maroon"). */
export function matchesAll(text: string, query: string | undefined): boolean {
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = text.toLowerCase();
  return words.every((w) => haystack.includes(w));
}
