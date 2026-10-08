import type { Paise } from './money';
import { editDistance, matchesAll } from './search';
import type { Customer, PaymentMethod, SaleVariant, Salesperson } from './types';

// "Type the bill": one line such as "2 kadhua ivory, 10% off, Meena, paid 5000 UPI" is read into the parts of a bill. Reading is by rules,
// on this computer, with no service: it splits the line at commas, decides what each piece is (an item, a discount, how it was paid,
// who the customer is…), then looks the names up among the shop's own items, customers and sales team. Whatever is unclear is not
// guessed at: it is shown for the person to choose.

// ── Reading the line ────────────────────────────────────────────────────────
export type QuickDiscount = { kind: 'percent'; percent: number } | { kind: 'amount'; paise: Paise };
export type QuickPayment = { mode: 'later' } | { mode: 'paid'; method: PaymentMethod | null; /** Null means all of it. */ amountPaise: Paise | null };

export interface QuickItemText {
  text: string;
  qty: number;
  /** A price typed for it ("at 14000"); null to use the item's own. */
  pricePaise: Paise | null;
}

export interface QuickParsed {
  items: QuickItemText[];
  /** Pieces of the line that might be an item or the customer's name: decided once the shop's own names are known. */
  plain: string[];
  customer: string | null;
  walkIn: boolean;
  discount: QuickDiscount | null;
  payment: QuickPayment | null;
  soldBy: string | null;
  dueDays: number | null;
  note: string | null;
  /** Pieces that could not be read. */
  unknown: string[];
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10 };

/** "5000", "5,000", "₹5k", "1.5 lakh", "rs 2500/-" → paise. Null when there is no amount in the text. */
export function parseAmount(text: string): Paise | null {
  const m = /(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakh|lac|lakhs)?(?![a-z0-9%])/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? '').toLowerCase();
  const rupees = unit === 'k' || unit === 'thousand' ? n * 1000 : unit ? n * 100_000 : n;
  return Math.round(rupees * 100);
}

const METHODS: [PaymentMethod, RegExp][] = [
  ['upi', /\b(upi|gpay|g ?pay|google ?pay|phone ?pe|paytm|bhim)\b/i],
  ['cash', /\bcash\b/i],
  ['card', /\b(card|debit|swipe|pos)\b/i],
  ['bank', /\b(bank|neft|rtgs|imps|transfer|online|net ?banking)\b/i],
  ['cheque', /\b(cheque|check|chq)\b/i],
];
const methodIn = (text: string): PaymentMethod | null => METHODS.find(([, re]) => re.test(text))?.[0] ?? null;

const FILLER = /\b(saree|sarees|sari|saris|piece|pieces|pcs|pc|nos|please|pls|the|of)\b/gi;

function itemFrom(part: string): QuickItemText | null {
  let text = part.trim();
  if (!text) return null;
  let pricePaise: Paise | null = null;
  const price = /(?:@|\bat\b|\bfor\b)\s*((?:₹|rs\.?)?\s*\d[\d,]*(?:\.\d+)?\s*(?:k|thousand|lakh|lac)?)\s*(?:\/-)?\s*(?:each|per piece|a piece)?\s*$/i.exec(text);
  if (price) {
    pricePaise = parseAmount(price[1]!);
    text = text.slice(0, price.index).trim();
  }
  let qty: number | null = null;
  const lead = /^(\d{1,3})(?![\d.])\s*(?:x|×|\*)?\s+/i.exec(text);
  const word = /^(one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|paanch|panch|chhe|saat|aath|nau|das)\s+/i.exec(text);
  const trail = /\s*[x×*]\s*(\d{1,3})$/i.exec(text);
  if (lead) {
    qty = Number(lead[1]);
    text = text.slice(lead[0].length);
  } else if (word) {
    qty = NUMBER_WORDS[word[1]!.toLowerCase()]!;
    text = text.slice(word[0].length);
  } else if (trail) {
    qty = Number(trail[1]);
    text = text.slice(0, trail.index);
  }
  text = text.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return { text, qty: qty ?? 1, pricePaise: qty === null && pricePaise === null ? null : pricePaise };
}

/**
 * "2 kadhua ivory paid 5000 upi" with the comma forgotten is two things: the item, and the payment. A payment word (or a "10%") that comes after
 * other words starts a new piece, so the item is kept and the amount is read from after the word, not from the "2" before it.
 */
function splitAtPayment(seg: string): string[] {
  const parts: string[] = [];
  let from = 0;
  for (const m of seg.matchAll(/\s(?:(?:paid|pays|paying|received|advance)\b|(?=\d+(?:\.\d+)?\s*(?:%|percent|per ?cent)))/gi)) {
    if (/[a-z]/i.test(seg.slice(from, m.index))) {
      parts.push(seg.slice(from, m.index));
      from = m.index;
    }
  }
  parts.push(seg.slice(from));
  return parts;
}

/** Reads one line into its parts. It never fails: what it cannot read is returned in `unknown`. */
export function parseQuickBill(line: string): QuickParsed {
  const out: QuickParsed = { items: [], plain: [], customer: null, walkIn: false, discount: null, payment: null, soldBy: null, dueDays: null, note: null, unknown: [] };
  // A comma inside an amount ("5,000") is not a break between parts.
  const segments = String(line ?? '')
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
    .split(/[,;\n]+/)
    .flatMap(splitAtPayment)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    const low = seg.toLowerCase();

    const note = /^(?:note|remark|remarks|memo)s?\s*[:\-]\s*(.+)$/i.exec(seg);
    if (note) {
      out.note = note[1]!.trim();
      continue;
    }
    const due = /\b(?:due|payment due|pay within)\s*(?:in|within|after)?\s*(\d{1,3})\s*days?\b/i.exec(low) ?? /\bnet\s*(\d{1,3})\b/i.exec(low) ?? /\b(\d{1,3})\s*days?\s*(?:credit|due|time)\b/i.exec(low);
    if (due) {
      out.dueDays = Number(due[1]);
      continue;
    }
    if (/\b(unpaid|pay later|payment later|pay after|on credit|udhaar|udhar|baki|baaki|not paid|will pay later)\b/.test(low) || (/^(credit|later)$/.test(low) && !/\bcard\b/.test(low))) {
      out.payment = { mode: 'later' };
      continue;
    }
    if (/\b(paid|pays|paying|received|payment|advance)\b/.test(low)) {
      const method = methodIn(low);
      const withoutWords = low.replace(/\b(paid|pays|paying|received|payment|advance|in|by|via|through|with|on|full|fully|completely|all|of|it|the|rs|inr)\b/g, ' ');
      const amount = parseAmount(withoutWords);
      out.payment = { mode: 'paid', method, amountPaise: amount };
      continue;
    }
    const percent = /(\d+(?:\.\d+)?)\s*(?:%|percent|per ?cent)/i.exec(low);
    const offWord = /\b(off|discount|disc|less|rebate|concession|reduce|reduction)\b/.test(low);
    if (percent && (offWord || /^\s*[\d.]+\s*(?:%|percent|per ?cent)\s*$/.test(low))) {
      out.discount = { kind: 'percent', percent: Number(percent[1]) };
      continue;
    }
    if (offWord) {
      const amount = parseAmount(low);
      if (amount !== null) {
        out.discount = { kind: 'amount', paise: amount };
        continue;
      }
    }
    const by = /^(?:sold by|sale by|sales ?person|seller|by)\s*[:\-]?\s+(.+)$/i.exec(seg);
    if (by) {
      out.soldBy = by[1]!.trim();
      continue;
    }
    if (/^walk[- ]?in(?:\s+customer)?$/i.test(seg)) {
      out.walkIn = true;
      continue;
    }
    const who = /^(?:for|to|customer|cust|name|buyer)\s*[:\-]?\s+(.+)$/i.exec(seg);
    if (who && !/^[\d.,\s]+$/.test(who[1]!)) {
      out.customer = who[1]!.trim();
      continue;
    }

    // What is left is one or more items, or a name that could be either.
    for (const part of seg.split(/\s+(?:and|\+|&)\s+/i)) {
      const item = itemFrom(part);
      if (!item) {
        // A bare "please" or "saree" is just politeness; a number with nothing after it (“2 sarees”) is worth pointing out.
        if (part.trim() && /\d/.test(part)) out.unknown.push(part.trim());
        continue;
      }
      const explicit = item.qty !== 1 || item.pricePaise !== null || /^(?:1|one|ek)\b/i.test(part.trim()) || /[x×*]\s*1$/i.test(part.trim());
      if (explicit) out.items.push(item);
      else out.plain.push(item.text);
    }
  }
  return out;
}

// ── Finding the shop's own names ────────────────────────────────────────────
export interface QuickItemPlan {
  raw: string;
  qty: number;
  pricePaise: Paise | null;
  /** The pieces it could be, best first. */
  candidates: SaleVariant[];
  /** Set when there is only one it could be (or only one in stock); otherwise the person chooses. */
  chosen: SaleVariant | null;
  /** The choice was made because it is the only one in stock, not because the words pinned it down. */
  assumed: boolean;
  /** Words read as another word the shop uses ("kadwa" as "kadhua"). */
  corrected: { from: string; to: string }[];
}

export interface QuickPlan {
  items: QuickItemPlan[];
  customer: { text: string; candidates: Customer[]; chosen: Customer | null } | null;
  walkInName: string | null;
  walkIn: boolean;
  discount: QuickDiscount | null;
  payment: QuickPayment | null;
  soldBy: { text: string; candidates: Salesperson[]; chosen: Salesperson | null } | null;
  dueDays: number | null;
  note: string | null;
  unknown: string[];
}

export interface QuickData {
  variants: SaleVariant[];
  customers: Customer[];
  team: Salesperson[];
}

/** The word the shop uses that a typed word is most likely a slip for: within one letter for a short word, two for a longer one. */
function nearestWord(word: string, vocabulary: string[]): string | null {
  if (word.length < 4) return null;
  const limit = word.length <= 4 ? 1 : 2;
  let best: { w: string; d: number } | null = null;
  for (const w of vocabulary) {
    const d = editDistance(word, w);
    if (d > 0 && d <= limit && (!best || d < best.d)) best = { w, d };
  }
  return best?.w ?? null;
}

const haystack = (v: SaleVariant) => `${v.designName} ${v.designNickname} ${v.designCode} ${v.color} ${v.size} ${v.sku} ${v.barcode}`;
const available = (v: SaleVariant) => v.stock - v.held > 0;
const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter(Boolean);
/** Every word typed is a whole word of the text (not just part of one): a strong match. */
const wholeWords = (text: string, query: string) => {
  const have = new Set(wordsOf(text));
  return wordsOf(query).every((w) => have.has(w));
};

/** The pieces a typed description could be: by code, by words, and failing that by words corrected to ones the shop uses. */
export function findVariants(query: string, variants: SaleVariant[]): { hits: SaleVariant[]; corrected: { from: string; to: string }[] } {
  const q = query.trim();
  if (!q) return { hits: [], corrected: [] };
  const code = q.toLowerCase();
  const exact = variants.filter((v) => v.sku.toLowerCase() === code || (v.barcode !== '' && v.barcode.toLowerCase() === code));
  if (exact.length === 1) return { hits: exact, corrected: [] };

  const rank = (list: SaleVariant[]) => {
    const first = wordsOf(q)[0] ?? '';
    return [...list]
      .sort((a, b) => Number(available(b)) - Number(available(a)) || Number(wordsOf(b.designName)[0] === first) - Number(wordsOf(a.designName)[0] === first) || a.designName.localeCompare(b.designName) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size))
      .slice(0, 8);
  };

  const direct = variants.filter((v) => matchesAll(haystack(v), q));
  if (direct.length > 0) return { hits: rank(direct), corrected: [] };

  // Nothing matched as typed: read each word that matches nothing as the nearest word the shop uses.
  const vocabulary = [...new Set(variants.flatMap((v) => wordsOf(`${v.designName} ${v.designNickname} ${v.color}`)).filter((w) => w.length >= 4))];
  const corrected: { from: string; to: string }[] = [];
  const fixed = wordsOf(q).map((w) => {
    if (variants.some((v) => haystack(v).toLowerCase().includes(w))) return w;
    const near = nearestWord(w, vocabulary);
    if (!near) return w;
    corrected.push({ from: w, to: near });
    return near;
  });
  if (corrected.length === 0) return { hits: [], corrected: [] };
  return { hits: rank(variants.filter((v) => matchesAll(haystack(v), fixed.join(' ')))), corrected };
}

function findCustomers(query: string, customers: Customer[]): Customer[] {
  const q = query.trim();
  if (!q) return [];
  const text = (c: Customer) => [c.name, c.phone, c.city].join(' ');
  let hits = customers.filter((c) => matchesAll(text(c), q));
  if (hits.length === 0) {
    const vocabulary = [...new Set(customers.flatMap((c) => wordsOf(c.name)).filter((w) => w.length >= 4))];
    const fixed = wordsOf(q).map((w) => (customers.some((c) => text(c).toLowerCase().includes(w)) ? w : nearestWord(w, vocabulary) ?? w));
    hits = customers.filter((c) => matchesAll(text(c), fixed.join(' ')));
  }
  const first = wordsOf(q)[0] ?? '';
  return hits.sort((a, b) => Number(wordsOf(b.name)[0] === first) - Number(wordsOf(a.name)[0] === first) || a.name.localeCompare(b.name)).slice(0, 6);
}

function itemPlan(raw: string, qty: number, pricePaise: Paise | null, variants: SaleVariant[]): QuickItemPlan {
  const { hits, corrected } = findVariants(raw, variants);
  const inStock = hits.filter(available);
  const only = hits.length === 1 ? hits[0]! : null;
  const assumed = !only && inStock.length === 1;
  return { raw, qty, pricePaise, candidates: hits, chosen: only ?? (assumed ? inStock[0]! : null), assumed, corrected };
}

/**
 * Looks up what was typed among the shop's own items, customers and sales team. A piece of the line that is not obviously an item is
 * tried as an item first, then as the customer; a whole-word match beats a part-of-a-word one, so "Meena" is the customer even if a
 * design is called "Meenakari".
 */
export function resolveQuickBill(parsed: QuickParsed, data: QuickData): QuickPlan {
  const items = parsed.items.map((i) => itemPlan(i.text, i.qty, i.pricePaise, data.variants));
  let customerText = parsed.customer;
  const unknown = [...parsed.unknown];

  for (const text of parsed.plain) {
    const v = findVariants(text, data.variants);
    const c = customerText === null ? findCustomers(text, data.customers) : [];
    const itemStrong = v.hits.some((x) => wholeWords(haystack(x), text));
    const customerStrong = c.some((x) => wholeWords(x.name, text));
    if (v.hits.length > 0 && !(customerStrong && !itemStrong)) items.push(itemPlan(text, 1, null, data.variants));
    else if (c.length > 0) customerText = text;
    else if (v.corrected.length > 0 || v.hits.length > 0) items.push(itemPlan(text, 1, null, data.variants));
    else unknown.push(text);
  }

  const candidates = customerText ? findCustomers(customerText, data.customers) : [];
  const soldByCandidates = parsed.soldBy ? data.team.filter((p) => matchesAll(p.name, parsed.soldBy!)) : [];
  return {
    items,
    customer: customerText ? { text: customerText, candidates, chosen: candidates.length === 1 || (candidates.length > 1 && wholeWords(candidates[0]!.name, customerText) && !wholeWords(candidates[1]!.name, customerText)) ? candidates[0]! : null } : null,
    walkInName: customerText && candidates.length === 0 ? customerText : null,
    walkIn: parsed.walkIn,
    discount: parsed.discount,
    payment: parsed.payment,
    soldBy: parsed.soldBy ? { text: parsed.soldBy, candidates: soldByCandidates, chosen: soldByCandidates.length === 1 ? soldByCandidates[0]! : null } : null,
    dueDays: parsed.dueDays,
    note: parsed.note,
    unknown,
  };
}
