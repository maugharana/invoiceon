import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { backupNow } from '../electron/backup';
import * as expenses from '../electron/services/expenses';
import * as inventory from '../electron/services/inventory';
import * as photos from '../electron/services/photos';
import { variantByCode } from '../electron/services/invoices';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pic = (n: number, mime = 'image/jpeg') => `data:${mime};base64,${Buffer.alloc(n, 7).toString('base64')}`;
const invoicesByCode = (code: string) => variantByCode(db, code);
let db: Db;
let designId: string;
let variantId: string;

beforeEach(() => {
  db = openDb(':memory:');
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '', description: '', defaultPricePaise: 100000 });
  designId = d.id;
  variantId = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: 100000, baseCostPaise: 0, reorderLevel: 0, openingStock: 1, bom: [] }).id;
});

const add = (ownerType: 'design' | 'variant' | 'expense', ownerId: string, n = 2000) => photos.addPhoto(db, { ownerType, ownerId, image: pic(n), thumb: pic(300) });

describe('pictures', () => {
  it('are kept in order, the first being the cover, and come back as they went in', () => {
    const a = add('design', designId);
    const b = add('design', designId);
    expect(photos.listPhotos(db, 'design', designId).map((p) => p.id)).toEqual([a.id, b.id]);
    expect(photos.getPhotoImage(db, a.id)).toBe(pic(2000));
    expect(a.thumb).toBe(pic(300));
    expect(photos.setCover(db, b.id).map((p) => p.id)).toEqual([b.id, a.id]);
    expect(photos.coverThumbs(db, 'design', [designId])).toEqual({ [designId]: pic(300) });
  });

  it('a design with none of its own shows its first colour\'s, and things without any are left out', () => {
    expect(photos.coverThumbs(db, 'design', [designId])).toEqual({});
    add('variant', variantId);
    expect(Object.keys(photos.coverThumbs(db, 'design', [designId]))).toEqual([designId]);
    expect(photos.coverThumbs(db, 'variant', ['nope'])).toEqual({});
    expect(photos.coverThumbs(db, 'design', [])).toEqual({});
  });

  it('are removed for good: the picture goes, and the list and cover forget it', () => {
    const a = add('design', designId);
    photos.deletePhoto(db, a.id);
    expect(photos.listPhotos(db, 'design', designId)).toEqual([]);
    expect(() => photos.getPhotoImage(db, a.id)).toThrow(/no longer exists/);
    expect(() => photos.deletePhoto(db, a.id)).toThrow(/no longer exists/);
    expect(db.prepare('SELECT image, bytes FROM photos WHERE id = ?').get(a.id)).toMatchObject({ image: null, bytes: 0 });
  });

  it('are refused when they are not pictures, are too big, or belong to nothing', () => {
    const bad = (over: Partial<Parameters<typeof photos.addPhoto>[1]>) => () => photos.addPhoto(db, { ownerType: 'design', ownerId: designId, image: pic(100), thumb: pic(100), ...over });
    expect(bad({ image: 'hello' })).toThrow(/JPEG, PNG or WebP/);
    expect(bad({ image: pic(100, 'image/gif') })).toThrow(/JPEG, PNG or WebP/);
    expect(bad({ image: 'data:image/jpeg;base64,' })).toThrow(/JPEG, PNG or WebP/);
    expect(bad({ image: pic(500_000) })).toThrow(/too large/);
    expect(bad({ thumb: pic(50_000) })).toThrow(/too large/);
    expect(bad({ ownerId: 'nope' })).toThrow(/no longer exists/);
    expect(bad({ ownerType: 'customer' as never })).toThrow(/design, a colour or an expense/);
    expect(photos.listPhotos(db, 'design', designId)).toEqual([]);
  });

  it('stop at a sensible number for each thing', () => {
    for (let i = 0; i < 10; i++) add('design', designId, 100);
    expect(() => add('design', designId, 100)).toThrow(/Up to 10/);
    const e = expenses.createExpense(db, { date: '2026-10-01', category: 'Rent', vendor: '', amountPaise: 100, method: 'cash', reference: '', note: '' });
    for (let i = 0; i < 4; i++) add('expense', e.id, 100);
    expect(() => add('expense', e.id, 100)).toThrow(/Up to 4/);
  });

  it('go through the typed API and are inside every backup', async () => {
    const api = createApi(db);
    const p = await api.photoAdd({ ownerType: 'variant', ownerId: variantId, image: pic(1500), thumb: pic(200) });
    expect((await api.photosList('variant', variantId)).length).toBe(1);
    expect(await api.photoGet(p.id)).toBe(pic(1500));
    expect(await api.photoCovers('variant', [variantId])).toEqual({ [variantId]: pic(200) });

    const dir = mkdtempSync(join(tmpdir(), 'invoiceon-ph-'));
    const { name } = backupNow(db, dir);
    const copy = openDb(join(dir, name));
    expect(photos.getPhotoImage(copy, p.id)).toBe(pic(1500));
    expect((await api.auditList())[0]).toMatchObject({ label: 'Added a picture' });
  });
});

describe('finding a piece by its code', () => {
  it('matches the SKU or a printed barcode, ignoring case, and nothing else', () => {
    const v = inventory.updateVariant(db, variantId, { color: 'Red', size: '6 m', barcode: '8901234567890', sellPricePaise: 100000, baseCostPaise: 0, reorderLevel: 0, bom: [] });
    const sku = v.sku;
    expect(invoicesByCode(sku.toLowerCase())?.variantId).toBe(variantId);
    expect(invoicesByCode('8901234567890')?.variantId).toBe(variantId);
    expect(invoicesByCode('  ' + sku + ' ')?.variantId).toBe(variantId);
    expect(invoicesByCode('nope')).toBeNull();
    expect(invoicesByCode('')).toBeNull();
  });

  it('keeps the barcode when a form that does not mention it saves the piece, and lets it be cleared', () => {
    inventory.updateVariant(db, variantId, { color: 'Red', size: '6 m', barcode: 'ABC123', sellPricePaise: 100000, baseCostPaise: 0, reorderLevel: 0, bom: [] });
    const kept = inventory.updateVariant(db, variantId, { color: 'Red', size: '6 m', sellPricePaise: 100000, baseCostPaise: 0, reorderLevel: 0, bom: [] });
    expect(kept.barcode).toBe('ABC123');
    expect(inventory.updateVariant(db, variantId, { color: 'Red', size: '6 m', barcode: '', sellPricePaise: 100000, baseCostPaise: 0, reorderLevel: 0, bom: [] }).barcode).toBe('');
  });

  it('never lets two pieces share a code, or a barcode copy another piece\'s SKU', () => {
    const other = inventory.createVariant(db, designId, { color: 'Blue', size: '6 m', barcode: 'SAME-1', sellPricePaise: 1, baseCostPaise: 0, reorderLevel: 0, bom: [] });
    const input = { color: 'Red', size: '6 m', sellPricePaise: 100000, baseCostPaise: 0, reorderLevel: 0, bom: [] };
    expect(() => inventory.updateVariant(db, variantId, { ...input, barcode: 'same-1' })).toThrow(/already belongs to/);
    expect(() => inventory.updateVariant(db, variantId, { ...input, barcode: other.sku })).toThrow(/already belongs to/);
    expect(() => inventory.updateVariant(db, variantId, { ...input, barcode: 'has space' })).toThrow(/without spaces/);
    // a new piece whose SKU is somebody's barcode is refused too
    expect(() => inventory.createVariant(db, designId, { color: 'Green', size: '6 m', sku: 'SAME-1', sellPricePaise: 1, baseCostPaise: 0, reorderLevel: 0, bom: [] })).toThrow(/already used as a barcode/);
  });
});
