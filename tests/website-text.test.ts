import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { saveSettings } from '../electron/services/settings';
import { websiteCsv } from '../shared/csv';
import type { BulkSareeRow } from '../shared/types';
import { buildListing, clip, slugify } from '../shared/websiteText';

const rupees = (n: number) => n * 100;
let db: Db;
let api: ReturnType<typeof createApi>;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { businessName: 'Mau Gharana', gstRatePercent: 5 });
  api = createApi(db);
});

const row = (over: Partial<BulkSareeRow> = {}): BulkSareeRow => ({ name: '', weaveStyle: 'Banarasi', fabric: 'Katan Silk', technique: 'Kadhua', pattern: 'Jaal', work: 'Zardozi Work, Aari Work', nickname: 'Lalima', sku: '', color: 'Maroon', size: '6.3 m', hsn: '', mrpPaise: 0, sellPricePaise: rupees(10000), costPaise: rupees(6000), stock: 2, reorderLevel: 0, ...over });

async function listing(rows: Partial<BulkSareeRow>[] = [{}]) {
  for (const r of rows) await api.inventoryQuickAdd(row(r));
  const [d] = await api.designsList();
  return buildListing(await api.designGet(d!.id), { name: 'Mau Gharana', gstRatePercent: 5 });
}

describe('website text', () => {
  it('names the page the way the saree is named, and explains each choice without claiming more than was recorded', async () => {
    const l = await listing([{}, { color: 'Wine', stock: 0 }]);
    expect(l.title).toBe('Banarasi Katan Silk Kadhua Jaal Saree with Zardozi Work and Aari Work, Lalima');
    const text = l.paragraphs.join(' ');
    expect(text).toContain('is a Banarasi Katan Silk saree woven in the Kadhua technique with a Jaal pattern and finished with Zardozi Work and Aari Work');
    expect(text).toContain('available in 2 colours: Maroon and Wine');
    expect(text).toContain('Varanasi');
    expect(text).toContain('each motif is woven separately');
    expect(text).toContain('Aari work is fine embroidery done with a hooked needle');
    expect(text).toContain('Care: dry cleaning is recommended');
    // Nothing the choices don't say.
    expect(text.toLowerCase()).not.toMatch(/handwoven|handloom|pure|authentic|blouse/);
  });

  it('keeps search text within the lengths search results show, with the searched words first', async () => {
    const l = await listing();
    expect(l.seoTitle.length).toBeLessThanOrEqual(60);
    expect(l.seoTitle.startsWith('Banarasi Katan Silk Kadhua Jaal Saree')).toBe(true);
    expect(l.seoDescription.length).toBeLessThanOrEqual(155);
    expect(l.seoDescription).toContain('Mau Gharana');
    expect(l.seoDescription).toMatch(/From ₹10,500/);
  });

  it('prices what the shopper pays: the printed price when there is one, otherwise the selling price plus GST', async () => {
    const l = await listing([{ mrpPaise: rupees(13000) }, { color: 'Wine', mrpPaise: 0 }]);
    expect(Object.fromEntries(l.variants.map((v) => [v.colour, v.pricePaise]))).toEqual({ Maroon: rupees(13000), Wine: rupees(10500) });
  });

  it('writes structured product data with each colour as an offer, in stock or not', async () => {
    const l = await listing([{ stock: 2 }, { color: 'Wine', stock: 0 }]);
    const data = JSON.parse(l.jsonLd);
    expect(data).toMatchObject({ '@type': 'Product', category: 'Sarees', material: 'Katan Silk', brand: { name: 'Mau Gharana' } });
    expect(data.offers).toHaveLength(2);
    expect(data.offers.map((o: { availability: string }) => o.availability.split('/').pop()).sort()).toEqual(['InStock', 'OutOfStock']);
    expect(data.offers[0]).toMatchObject({ priceCurrency: 'INR', price: '10500.00' });
  });

  it('collects tags from the choices and colours, and gives a web address ending with the design code', async () => {
    const l = await listing();
    expect(l.tags).toEqual(expect.arrayContaining(['saree', 'Banarasi', 'Katan Silk', 'Kadhua', 'Jaal', 'Zardozi Work', 'Aari Work', 'Maroon']));
    expect(l.handle).toMatch(/^banarasi-katan-silk-kadhua-jaal-saree-with-zardozi-work-and-aari-work-lalima-mg-\d+$/);
  });

  it('is short and still sensible for a design with only a hand typed name', async () => {
    const d = await api.designCreate({ code: 'MG-9', name: 'Our Own Piece', fabric: '', hsnCode: '', description: '', defaultPricePaise: 0 });
    const l = buildListing(await api.designGet(d.id), { name: 'Mau Gharana', gstRatePercent: 5 });
    expect(l.title).toBe('Our Own Piece');
    expect(l.paragraphs[0]).toMatch(/^Our Own Piece is a saree\./);
    expect(JSON.parse(l.jsonLd).offers).toEqual([]);
  });

  it('exports a product file as drafts, one row for each colour and length, with the product details on the first row only', async () => {
    await api.inventoryQuickAdd(row());
    await api.inventoryQuickAdd(row({ color: 'Wine', size: '5.5 m' }));
    const listings = await api.websiteListings();
    const csv = websiteCsv(listings, { name: 'Mau Gharana' });
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Handle,Title,Body (HTML)');
    expect(lines[1]).toContain('Saree,');
    expect(lines[1]).toContain(',draft');
    expect(lines[1]).toContain('<p>');
    expect(lines[2]!.split(',')[1]).toBe(''); // no title on the second variant's row
    expect(lines[2]).toContain('Wine');
  });

  it('cuts text at a word and makes web addresses from it', () => {
    expect(clip('A short title', 60)).toBe('A short title');
    expect(clip('Banarasi Katan Silk Kadhua Jaal Saree with Zardozi Work and Aari Work', 40)).toBe('Banarasi Katan Silk Kadhua Jaal Saree…');
    expect(slugify('Rang Bahar & Co.')).toBe('rang-bahar-co');
  });
});
