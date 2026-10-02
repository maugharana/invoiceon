/**
 * How a saree is named. A product title that leads with what shoppers search for ranks best in Google and is picked up most
 * reliably by AI assistants: weave style, then fabric, then technique, then the pattern, then the word "Saree", then any special work, and
 * the shop's own special name last, so it never pushes the searched words out of the first part of the title.
 *
 *   Banarasi Katan Silk Kadhua Butidar Saree with Zardozi Work, Lalima         (the design)
 *   Maroon Banarasi Katan Silk Kadhua Butidar Saree with Zardozi Work, Lalima  (one colour of it)
 *
 * Colour is not part of the design, because one design comes in several colours, so it only joins the front for a single piece.
 */
export const CATALOGUE_KINDS = ['weaveStyle', 'fabric', 'technique', 'pattern', 'work', 'colour'] as const;
export type CatalogueKind = (typeof CATALOGUE_KINDS)[number];

/** Choices every shop starts with. Anything a shop adds or already uses is merged in on top of these. Most searched first. */
export const DEFAULT_OPTIONS: Record<CatalogueKind, readonly string[]> = {
  weaveStyle: ['Banarasi', 'Kanjivaram', 'Chanderi', 'Maheshwari', 'Paithani', 'Patola', 'Bandhani', 'Tussar', 'Jamdani', 'Bhagalpuri', 'Kota Doria', 'Pochampally', 'Baluchari', 'Mysore Silk', 'Gadwal', 'Uppada', 'Sambalpuri', 'Venkatagiri', 'Muga', 'Kalamkari', 'Ikat'],
  fabric: ['Katan Silk', 'Pure Silk', 'Silk Blend', 'Georgette', 'Khaddi Georgette', 'Organza', 'Tissue', 'Cotton Silk', 'Silk Cotton', 'Pure Cotton', 'Crepe', 'Chiffon', 'Satin', 'Tussar Silk', 'Linen', 'Velvet'],
  technique: ['Kadhua', 'Phekua', 'Cutwork', 'Tanchoi', 'Meenakari', 'Jamdani', 'Jangla', 'Tilfi', 'Rangkat', 'Shikargah', 'Brocade', 'Kimkhab', 'Jacquard', 'Dobby', 'Ikat', 'Bandhani'],
  /** One pattern per saree: a Jaal saree is not a Butidar one, so this is a single choice. */
  pattern: ['Butidar', 'Jaal', 'Buta', 'Bel', 'Kairi', 'Paisley', 'Floral', 'Konia', 'Stripes', 'Checks', 'Geometric', 'Temple Border', 'Plain'],
  work: ['Zardozi Work', 'Aari Work', 'Zari Work', 'Resham Embroidery', 'Gota Patti Work', 'Chikankari Work', 'Kantha Work', 'Mirror Work', 'Cutdana Work', 'Sequin Work', 'Stone Work', 'Pearl Work', 'Thread Work', 'Applique Work', 'Mukaish Work', 'Hand Painted'],
  colour: ['Maroon', 'Red', 'Pink', 'Rani Pink', 'Peach', 'Orange', 'Mustard', 'Yellow', 'Gold', 'Cream', 'Off White', 'White', 'Green', 'Emerald Green', 'Bottle Green', 'Mint Green', 'Teal', 'Sky Blue', 'Royal Blue', 'Navy Blue', 'Purple', 'Wine', 'Lavender', 'Grey', 'Black', 'Brown', 'Beige', 'Silver', 'Multicolour'],
};

export interface NameParts {
  weaveStyle?: string;
  fabric?: string;
  technique?: string;
  /** Butidar, Jaal… one only. */
  pattern?: string;
  /** One or more works, separated by commas. */
  work?: string;
  /** The shop's own special name: one word or a phrase. */
  specialName?: string;
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** "Zardozi Work, Aari Work" as a list. A comma is the separator, so a work's own name can't contain one. */
export function splitWorks(work: string | undefined): string[] {
  const seen = new Set<string>();
  return (work ?? '')
    .split(',')
    .map(clean)
    .filter((w) => w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()));
}

function worksPhrase(works: string[]): string {
  if (works.length === 0) return '';
  if (works.length === 1) return works[0]!;
  return `${works.slice(0, -1).join(', ')} and ${works.at(-1)}`;
}

/**
 * The design's full name, or an empty string when there is nothing to build it from (a special name alone is not enough, so a
 * name typed by hand is never replaced by a bare "Saree").
 */
export function buildDesignName(p: NameParts): string {
  const works = splitWorks(p.work);
  const lead = [clean(p.weaveStyle), clean(p.fabric), clean(p.technique), clean(p.pattern)].filter(Boolean).join(' ');
  if (!lead && works.length === 0) return '';
  const body = `${lead ? `${lead} ` : ''}Saree${works.length ? ` with ${worksPhrase(works)}` : ''}`;
  const special = clean(p.specialName);
  return special ? `${body}, ${special}` : body;
}

/** The title of one colour of a design: the design's name with the colour in front. Empty when the design has no built name. */
export function buildPieceTitle(p: NameParts, colour: string): string {
  const name = buildDesignName(p);
  const c = clean(colour);
  return name && c ? `${c} ${name}` : name;
}
