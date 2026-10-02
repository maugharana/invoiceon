/**
 * Reads pasted or uploaded spreadsheet text into rows of cells. It copes with what Excel and Google Sheets produce: commas, tabs or
 * semicolons between cells, quoted cells that contain commas or line breaks, doubled quotes, a byte-order mark, and Windows or Unix
 * line endings. Completely empty lines are skipped.
 */
export function parseTable(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => firstLine.split(c).length - 1;
  // Tabs mean a paste from a sheet; otherwise whichever of comma or semicolon is more common in the first line.
  const delimiter = count('\t') > 0 ? '\t' : count(';') > count(',') ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

/** Lower-case, letters and digits only, so "Paid To", "paid_to" and "PAID-TO" are the same heading. */
export const headingKey = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Finds which column holds what, from the first row, by the names people actually use. Returns null if that row doesn't look like
 * headings at all (so the caller can treat it as data and use a fixed column order).
 */
export function mapHeadings<K extends string>(firstRow: string[], names: Record<K, string[]>): Partial<Record<K, number>> | null {
  const found: Partial<Record<K, number>> = {};
  firstRow.forEach((h, i) => {
    const key = headingKey(h);
    for (const field of Object.keys(names) as K[]) if (found[field] === undefined && names[field].includes(key)) found[field] = i;
  });
  return Object.keys(found).length >= 2 ? found : null;
}
