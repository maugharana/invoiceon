import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { backupNow, restoreBackup } from '../electron/backup';
import { openDb, type Db } from '../electron/db/connection';
import { catalogueData } from '../electron/services/catalogue';
import * as inventory from '../electron/services/inventory';
import * as photos from '../electron/services/photos';
import { saveSettings } from '../electron/services/settings';
import { DEFAULT_CATALOGUE, MAX_CATALOGUE_DESIGNS, MAX_PHOTOS_PER_DESIGN, cataloguePrice, coloursOf, encodeCatalogueRequest, parseCatalogueRequest } from '../shared/catalogue';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { businessName: 'Mau Gharana', phone: '9876543210', city: 'Mau' });
});

const rupees = (n: number) => n * 100;
const pad = (head: number[], length = 40) => Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, length - head.length), 1)]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), Buffer.alloc(20, 1)]);
const url = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;
const jpeg = (size = 40) => url('image/jpeg', Buffer.concat([JPEG, Buffer.alloc(size, 7)]));
const photo = () => ({ image: jpeg(), thumb: jpeg(10) });

function design(code: string, name: string, colours: { color: string; stock: number; price?: number; mrp?: number }[]) {
  const d = inventory.createDesign(db, { code, name, fabric: 'Silk', hsnCode: '5007', description: `${name} in pure silk`, defaultPricePaise: rupees(3000) });
  for (const c of colours) inventory.createVariant(db, d.id, { color: c.color, size: '5.5 m', sellPricePaise: rupees(c.price ?? 3000), mrpPaise: rupees(c.mrp ?? 0), baseCostPaise: rupees(1200), reorderLevel: 0, openingStock: c.stock, bom: [] });
  return d;
}

describe('design photos', () => {
  it('keeps photos in order, the first being the cover', () => {
    const d = design('MG-1', 'Butidar', [{ color: 'Red', stock: 1 }]);
    photos.addPhoto(db, d.id, photo());
    const list = photos.addPhoto(db, d.id, { image: url('image/png', PNG), thumb: url('image/png', PNG) });
    expect(list.map((p) => [p.position, p.image.slice(0, 15)])).toEqual([[0, 'data:image/jpeg'], [1, 'data:image/png;']]);
    expect(photos.listPhotos(db, d.id)).toHaveLength(2);
    // The bytes that come back are the bytes that went in.
    expect(list[0]!.image).toBe(jpeg());
  });

  it('accepts JPEG, PNG and WebP and nothing else', () => {
    const d = design('MG-1', 'Butidar', [{ color: 'Red', stock: 1 }]);
    photos.addPhoto(db, d.id, { image: url('image/webp', WEBP), thumb: url('image/webp', WEBP) });
    expect(() => photos.addPhoto(db, d.id, { image: 'data:image/svg+xml;base64,PHN2Zy8+', thumb: jpeg() })).toThrow(/not a JPEG, PNG or WebP/);
    expect(() => photos.addPhoto(db, d.id, { image: 'https://example.com/a.jpg', thumb: jpeg() })).toThrow(/not a JPEG, PNG or WebP/);
    expect(() => photos.addPhoto(db, d.id, { image: jpeg(), thumb: 'nope' })).toThrow(/thumbnail is not/);
    expect(() => photos.addPhoto(db, d.id, null as never)).toThrow(/not a JPEG/);
  });

  it('trusts what the file is, not what it says it is', () => {
    const d = design('MG-1', 'Butidar', [{ color: 'Red', stock: 1 }]);
    const script = Buffer.from('<script>alert(1)</script> padded out to be long enough');
    expect(() => photos.addPhoto(db, d.id, { image: url('image/jpeg', script), thumb: jpeg() })).toThrow(/not really a JPEG/);
    expect(() => photos.addPhoto(db, d.id, { image: url('image/jpeg', PNG), thumb: jpeg() })).toThrow(/not really a JPEG/);
    expect(photos.listPhotos(db, d.id)).toEqual([]);
  });

  it('refuses a photo or thumbnail that is too big', () => {
    const d = design('MG-1', 'Butidar', [{ color: 'Red', stock: 1 }]);
    expect(() => photos.addPhoto(db, d.id, { image: jpeg(1_600_000), thumb: jpeg() })).toThrow(/photo is too large/);
    expect(() => photos.addPhoto(db, d.id, { image: jpeg(), thumb: jpeg(200_000) })).toThrow(/thumbnail is too large/);
  });

  it('stops at the limit per design, and says which design is missing', () => {
    const d = design('MG-1', 'Butidar', [{ color: 'Red', stock: 1 }]);
    for (let i = 0; i < MAX_PHOTOS_PER_DESIGN; i++) photos.addPhoto(db, d.id, photo());
    expect(() => photos.addPhoto(db, d.id, photo())).toThrow(/can have 6 photos/);
    expect(() => photos.addPhoto(db, 'no-such-design', photo())).toThrow(/no longer exists/);
  });

  it('closes the gap when one is removed, and can choose a new cover', () => {
    const d = design('MG-1', 'Butidar', [{ color: 'Red', stock: 1 }]);
    const [a] = photos.addPhoto(db, d.id, { image: jpeg(1), thumb: jpeg(1) });
    photos.addPhoto(db, d.id, { image: jpeg(2), thumb: jpeg(2) });
    const three = photos.addPhoto(db, d.id, { image: jpeg(3), thumb: jpeg(3) });
    photos.setCover(db, three[2]!.id);
    expect(photos.listPhotos(db, d.id).map((p) => p.image.length)).toEqual([three[2]!.image.length, a!.image.length, three[1]!.image.length]);
    photos.removePhoto(db, three[2]!.id);
    expect(photos.listPhotos(db, d.id).map((p) => p.position)).toEqual([0, 1]);
    expect(() => photos.removePhoto(db, three[2]!.id)).toThrow(/already gone/);
    expect(() => photos.setCover(db, 'nope')).toThrow(/is gone/);
  });

  it('gives each design with photos its small cover for the lists, and forgets archived designs', () => {
    const a = design('MG-1', 'Butidar', [{ color: 'Red', stock: 1 }]);
    const b = design('MG-2', 'Paithani', [{ color: 'Blue', stock: 1 }]);
    design('MG-3', 'Plain', [{ color: 'Green', stock: 1 }]);
    photos.addPhoto(db, a.id, { image: jpeg(), thumb: jpeg(5) });
    photos.addPhoto(db, b.id, { image: jpeg(), thumb: jpeg(6) });
    const covers = photos.coverThumbs(db);
    expect(Object.keys(covers).sort()).toEqual([a.id, b.id].sort());
    expect(covers[a.id]).toBe(jpeg(5));
    inventory.archiveDesign(db, b.id);
    expect(Object.keys(photos.coverThumbs(db))).toEqual([a.id]);
  });

  it('comes back with a restored backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'invoiceon-photos-'));
    const d = design('MG-1', 'Butidar', [{ color: 'Red', stock: 1 }]);
    photos.addPhoto(db, d.id, photo());
    const { name } = backupNow(db, dir);
    photos.removePhoto(db, photos.listPhotos(db, d.id)[0]!.id);
    expect(photos.listPhotos(db, d.id)).toEqual([]);
    restoreBackup(db, dir, name);
    expect(photos.listPhotos(db, d.id)).toHaveLength(1);
  });
});

describe('the catalogue request', () => {
  it('round trips', () => {
    const r = { title: 'Diwali 2026', designIds: ['abcdef12-3456', 'fedcba98-7654'], inStockOnly: false, showPrices: false, columns: 2 as const };
    expect(parseCatalogueRequest(encodeCatalogueRequest(r))).toEqual(r);
    expect(parseCatalogueRequest('')).toEqual(DEFAULT_CATALOGUE);
  });

  it('drops anything malformed instead of trusting it', () => {
    const q = parseCatalogueRequest(`title=${'x'.repeat(200)}&designs=ok-design-1234,<script>,../../x,short,${'a'.repeat(100)}&cols=9&stock=maybe`);
    expect(q.title).toHaveLength(80);
    expect(q.designIds).toEqual(['ok-design-1234']);
    expect(q.columns).toBe(3);
    expect(q.inStockOnly).toBe(true);
    const many = Array.from({ length: 400 }, (_, i) => `design-${String(i).padStart(6, '0')}`).join(',');
    expect(parseCatalogueRequest(`designs=${many}`).designIds).toHaveLength(MAX_CATALOGUE_DESIGNS);
  });
});

describe('what the catalogue prints', () => {
  it('lists designs with their cover, colours and pieces, and no costs', () => {
    const d = design('MG-1', 'Butidar', [{ color: 'Red', stock: 3 }, { color: 'Blue', stock: 0 }]);
    photos.addPhoto(db, d.id, { image: jpeg(9), thumb: jpeg(1) });
    const c = catalogueData(db, { ...DEFAULT_CATALOGUE, inStockOnly: false });
    expect(c).toMatchObject({ title: 'Catalogue', businessName: 'Mau Gharana', phone: '9876543210', city: 'Mau' });
    expect(c.items).toHaveLength(1);
    expect(c.items[0]).toMatchObject({ code: 'MG-1', name: 'Butidar', fabric: 'Silk', photo: jpeg(9) });
    expect(c.items[0]!.variants.map((v) => [v.color, v.stock])).toEqual([['Blue', 0], ['Red', 3]]);
    expect(JSON.stringify(c)).not.toMatch(/cost|profit|margin/i);
  });

  it('leaves out what is not in stock, unless asked', () => {
    design('MG-1', 'Butidar', [{ color: 'Red', stock: 3 }, { color: 'Blue', stock: 0 }]);
    design('MG-2', 'Paithani', [{ color: 'Green', stock: 0 }]);
    const inStock = catalogueData(db, DEFAULT_CATALOGUE);
    expect(inStock.items.map((i) => i.name)).toEqual(['Butidar']);
    expect(inStock.items[0]!.variants.map((v) => v.color)).toEqual(['Red']);
    expect(catalogueData(db, { ...DEFAULT_CATALOGUE, inStockOnly: false }).items.map((i) => i.name)).toEqual(['Butidar', 'Paithani']);
  });

  it('prints only the designs chosen, and never archived ones', () => {
    const a = design('MG-1', 'Butidar', [{ color: 'Red', stock: 3 }]);
    const b = design('MG-2', 'Paithani', [{ color: 'Green', stock: 3 }]);
    const gone = design('MG-3', 'Old', [{ color: 'Grey', stock: 3 }]);
    inventory.archiveDesign(db, gone.id);
    expect(catalogueData(db, { ...DEFAULT_CATALOGUE, designIds: [b.id] }).items.map((i) => i.name)).toEqual(['Paithani']);
    expect(catalogueData(db, DEFAULT_CATALOGUE).items.map((i) => i.name)).toEqual(['Butidar', 'Paithani']);
    expect(a.id).not.toBe(b.id);
  });

  it('prices by MRP when every piece has one, else by selling price plus GST', () => {
    const v = (mrp: number, price: number) => ({ color: 'Red', size: 'x', stock: 1, sellPricePaise: rupees(price), mrpPaise: rupees(mrp) });
    expect(cataloguePrice([v(4000, 3000), v(5000, 3500)])).toEqual({ fromPaise: rupees(4000), toPaise: rupees(5000), plusGst: false });
    expect(cataloguePrice([v(4000, 3000), v(0, 3500)])).toEqual({ fromPaise: rupees(3000), toPaise: rupees(3500), plusGst: true });
    expect(cataloguePrice([])).toBeNull();
  });

  it('counts pieces per colour, most first', () => {
    const v = (color: string, stock: number) => ({ color, size: 'x', stock, sellPricePaise: 1, mrpPaise: 0 });
    expect(coloursOf([v('Red', 1), v('Blue', 4), v('Red', 2)])).toEqual([{ color: 'Blue', pieces: 4 }, { color: 'Red', pieces: 3 }]);
  });
});
