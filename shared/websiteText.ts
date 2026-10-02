import { buildPieceTitle, splitWorks } from './nomenclature';
import { formatMoney } from './money';
import type { DesignDetail } from './types';

/**
 * Text for a product page, built only from what the shop has recorded about a saree: its choices, colours, sizes and prices. Nothing
 * is claimed that the choices don't say (no "handwoven", no weaver, no blouse piece): the person adds those. What it adds is the
 * plain meaning of each choice, which is what shoppers and AI assistants look for on a product page.
 */

// ── What the choices mean ───────────────────────────────────────────────────
const WEAVE_NOTE: Record<string, string> = {
  banarasi: 'Banarasi weaving comes from Varanasi (Banaras) in Uttar Pradesh and is known for rich brocade work in silk and zari.',
  kanjivaram: 'Kanjivaram sarees come from Kanchipuram in Tamil Nadu and are known for their body of mulberry silk and contrasting borders.',
  chanderi: 'Chanderi weaving comes from the town of Chanderi in Madhya Pradesh and is known for sheer, light fabric with a soft sheen.',
  maheshwari: 'Maheshwari weaving comes from Maheshwar in Madhya Pradesh and is known for light fabric and reversible borders.',
  paithani: 'Paithani weaving comes from Paithan in Maharashtra and is known for silk with woven peacock and floral motifs.',
  patola: 'Patola weaving comes from Patan in Gujarat and is known for double ikat silk with sharp geometric patterns.',
  bandhani: 'Bandhani is a tie and dye craft from Gujarat and Rajasthan, where cloth is bound at points before dyeing to make dotted patterns.',
  tussar: 'Tussar is a natural, textured silk with a golden sheen, woven in Bihar, Jharkhand and Chhattisgarh.',
  jamdani: 'Jamdani is a fine woven fabric where the motifs are built into the cloth as it is woven.',
  bhagalpuri: 'Bhagalpuri sarees come from Bhagalpur in Bihar and are known for tussar and silk weaves.',
  'kota doria': 'Kota Doria comes from Kota in Rajasthan and is known for light, airy fabric woven in a checked pattern.',
  pochampally: 'Pochampally sarees come from Telangana and are known for ikat patterns, where yarn is dyed before it is woven.',
  baluchari: 'Baluchari sarees come from West Bengal and are known for woven scenes and figures in the border and pallu.',
  'mysore silk': 'Mysore silk comes from Karnataka and is known for soft, smooth silk with a quiet sheen.',
  gadwal: 'Gadwal sarees come from Telangana and are known for a cotton body joined to a silk border.',
  uppada: 'Uppada sarees come from Andhra Pradesh and are known for light silk with fine woven motifs.',
  sambalpuri: 'Sambalpuri sarees come from Odisha and are known for ikat patterns woven in cotton and silk.',
  venkatagiri: 'Venkatagiri sarees come from Andhra Pradesh and are known for fine cotton with zari borders.',
  muga: 'Muga silk comes from Assam and is known for its natural golden colour.',
  kalamkari: 'Kalamkari is a craft from Andhra Pradesh where patterns are drawn or block printed on cloth with natural dyes.',
  ikat: 'Ikat is a technique where the yarn is dyed in patterns before it is woven, so the design appears in the cloth itself.',
};

const TECHNIQUE_NOTE: Record<string, string> = {
  kadhua: 'In the Kadhua (also spelt Kadwa) technique, each motif is woven separately by hand with an extra weft thread, so the back of the saree stays clean with very few loose threads.',
  phekua: 'In the Phekua technique, the weft thread is carried across the cloth to make the motifs, and the loose threads left on the back are then cut away.',
  cutwork: 'In Cutwork, the weft thread is carried across the cloth to make the motifs, and the loose threads left on the back are then cut away.',
  tanchoi: 'Tanchoi is a fine weave that uses coloured weft threads to make small, close motifs, with no loose threads on the back.',
  meenakari: 'Meenakari adds coloured silk threads to the woven pattern, in addition to the zari, to bring in more colour.',
  jamdani: 'In the Jamdani technique, the motifs are built into the cloth as it is woven, thread by thread.',
  jangla: 'Jangla is an all over pattern of branching vines or creepers woven across the saree.',
  brocade: 'Brocade is a rich woven fabric with raised patterns, often in metallic thread.',
};

const PATTERN_NOTE: Record<string, string> = {
  butidar: 'Butidar means the saree carries small woven motifs (butis) scattered across its body.',
  jaal: 'A Jaal pattern is an all over network of connected motifs that covers the body of the saree.',
  buta: 'A Buta is a single, larger woven motif, repeated across the saree.',
  bel: 'A Bel pattern is a climbing vine or creeper woven across the saree.',
  kairi: 'The Kairi (paisley) is a mango shaped motif, a classic of Indian weaving.',
  konia: 'A Konia is a corner motif, woven at the edges of the pallu or border.',
  'temple border': 'A Temple Border is a woven border with a stepped, temple like outline.',
  plain: 'A Plain saree has an unpatterned body.',
};

const WORK_NOTE: Record<string, string> = {
  'zardozi work': 'Zardozi is metal thread embroidery, often with beads, pearls or stones, that gives a rich, raised finish.',
  'aari work': 'Aari work is fine embroidery done with a hooked needle, making tight chain stitches.',
  'zari work': 'Zari work uses fine metallic thread to make shining patterns.',
  'resham embroidery': 'Resham embroidery is done with silk thread, in soft colours.',
  'gota patti work': 'Gota Patti work applies ribbon like metallic strips to the cloth in shining patterns.',
  'chikankari work': 'Chikankari is a white thread embroidery from Lucknow, made of many stitches such as shadow work and knots.',
  'kantha work': 'Kantha work is made of simple running stitches that form flowing, layered patterns.',
  'mirror work': 'Mirror work sets small reflective mirrors into the cloth with embroidered frames.',
};

const note = (table: Record<string, string>, key: string): string => table[key.trim().toLowerCase()] ?? '';

// ── Building a listing ──────────────────────────────────────────────────────
/** What the shopper pays for one piece: the printed MRP when there is one, otherwise the selling price plus GST. */
export const shopperPricePaise = (v: { mrpPaise: number; sellPricePaise: number }, ratePercent: number): number => (v.mrpPaise > 0 ? v.mrpPaise : Math.round(v.sellPricePaise * (1 + ratePercent / 100)));

export interface ListingVariant {
  sku: string;
  colour: string;
  size: string;
  stock: number;
  /** What the shopper pays: the printed MRP when there is one, otherwise the selling price plus GST. */
  pricePaise: number;
}

export interface WebsiteListing {
  /** The design's own name: what the product is called, without a colour. */
  title: string;
  /** For a web address: lower case words joined by dashes, then the design code. */
  handle: string;
  /** As it would show in search results: aims for about 60 characters. */
  seoTitle: string;
  /** About 155 characters. */
  seoDescription: string;
  /** The description, one paragraph each. */
  paragraphs: string[];
  /** Short facts, label then value. */
  details: { label: string; value: string }[];
  tags: string[];
  colours: string[];
  variants: ListingVariant[];
  /** schema.org Product data, as JSON, for the product page's head. */
  jsonLd: string;
}

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Cuts text to a limit at a word boundary, with no dangling punctuation. */
export function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > limit * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, '')}…`;
}

const list = (items: string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

export function buildListing(design: DesignDetail, shop: { name: string; gstRatePercent: number }): WebsiteListing {
  const parts = { weaveStyle: design.weaveStyle, fabric: design.fabric, technique: design.technique, pattern: design.pattern, work: design.work, specialName: design.nickname };
  const works = splitWorks(design.work);
  const priced = design.variants.map((v): ListingVariant => {
    const rate = design.gstRatePercent ?? shop.gstRatePercent;
    return { sku: v.sku, colour: v.color, size: v.size, stock: v.stock, pricePaise: shopperPricePaise(v, rate) };
  });
  const colours = [...new Map(priced.map((v) => [v.colour.toLowerCase(), v.colour])).values()];
  const sizes = [...new Map(priced.map((v) => [v.size.toLowerCase(), v.size])).values()];
  const title = design.name;
  const lowest = priced.length ? Math.min(...priced.map((v) => v.pricePaise)) : 0;

  const intro = [
    `${title} is a ${[design.weaveStyle, design.fabric].filter(Boolean).join(' ')} saree`.replace('is a  saree', 'is a saree'),
    design.technique ? `woven in the ${design.technique} technique` : '',
    design.pattern ? `with a ${design.pattern} pattern` : '',
    works.length ? `and finished with ${list(works)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const availability = colours.length > 0 ? `It is available in ${colours.length === 1 ? colours[0] : `${colours.length} colours: ${list(colours)}`}${sizes.length ? `, in ${list(sizes)}` : ''}.` : '';
  const paragraphs = [
    `${intro}.${availability ? ` ${availability}` : ''}`,
    [note(WEAVE_NOTE, design.weaveStyle), note(TECHNIQUE_NOTE, design.technique)].filter(Boolean).join(' '),
    [note(PATTERN_NOTE, design.pattern), ...works.map((w) => note(WORK_NOTE, w))].filter(Boolean).join(' '),
    /silk|zari/i.test(`${design.fabric} ${design.work}`) ? 'Care: dry cleaning is recommended. Store it folded in a soft muslin or cotton cloth, away from direct sunlight.' : '',
  ].filter(Boolean);

  const details = [
    { label: 'Weave style', value: design.weaveStyle },
    { label: 'Fabric', value: design.fabric },
    { label: 'Technique', value: design.technique },
    { label: 'Pattern', value: design.pattern },
    { label: 'Special work', value: list(works) },
    { label: 'Colours', value: list(colours) },
    { label: 'Length', value: list(sizes) },
    { label: 'Name', value: design.nickname },
    { label: 'Design code', value: design.code },
  ].filter((d) => d.value);

  const tags = [...new Set(['saree', design.weaveStyle, design.fabric, design.technique, design.pattern, ...works, ...colours, ...design.tags.split(',').map((t) => t.trim())].map((t) => t.trim()).filter(Boolean))];

  const seoTitle = clip(`${buildPieceTitle({ ...parts, specialName: '' }, '') || title} | ${shop.name}`, 60).replace(/\s*\|\s*…$/, '…');
  // In order of importance: what it is and who sells it, what it costs, then what the technique means. Each is added only if it fits.
  const firstSentence = (text: string) => (text.split('. ')[0] ?? '').trim().replace(/\.$/, '');
  const meaning = firstSentence(note(TECHNIQUE_NOTE, design.technique) || note(WEAVE_NOTE, design.weaveStyle));
  let seoDescription = '';
  for (const piece of [`Shop the ${title}${shop.name ? ` from ${shop.name}` : ''}.`, lowest > 0 ? `From ${formatMoney(lowest, { fractionDigits: 0 })}.` : '', meaning ? `${meaning}.` : '']) {
    if (!piece) continue;
    const next = seoDescription ? `${seoDescription} ${piece}` : piece;
    if (next.length <= 155) seoDescription = next;
    else if (!seoDescription) seoDescription = clip(piece, 155);
  }

  const jsonLd = JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: title,
      description: paragraphs[0] ?? title,
      category: 'Sarees',
      ...(design.fabric ? { material: design.fabric } : {}),
      ...(colours.length ? { color: colours.join(', ') } : {}),
      brand: { '@type': 'Brand', name: shop.name },
      sku: design.code,
      offers: priced.map((v) => ({
        '@type': 'Offer',
        sku: v.sku,
        name: [v.colour, v.size].filter(Boolean).join(', '),
        price: (v.pricePaise / 100).toFixed(2),
        priceCurrency: 'INR',
        itemCondition: 'https://schema.org/NewCondition',
        availability: v.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      })),
    },
    null,
    2,
  );

  return { title, handle: `${slugify(title).slice(0, 80)}-${slugify(design.code)}`.replace(/^-/, ''), seoTitle, seoDescription, paragraphs, details, tags, colours, variants: priced, jsonLd };
}
