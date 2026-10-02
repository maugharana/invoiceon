import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { DEFAULT_OPTIONS, guessChoices } from '../shared/nomenclature';
import type { BulkSareeRow } from '../shared/types';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const row = (over: Partial<BulkSareeRow> = {}): BulkSareeRow => ({
  name: '',
  weaveStyle: 'Banarasi',
  fabric: 'Katan Silk',
  technique: 'Kadhua',
  pattern: '',
  work: '',
  nickname: 'Lalima',
  sku: '',
  color: 'Maroon',
  size: '6.3 m',
  hsn: '',
  mrpPaise: 0,
  sellPricePaise: 1000000,
  costPaise: 600000,
  stock: 1,
  reorderLevel: 0,
  ...over,
});

const design = (code: string, name: string, over: Record<string, unknown> = {}) => ({ code, name, fabric: '', hsnCode: '', description: '', defaultPricePaise: 0, ...over });

describe('guessing choices from a typed name', () => {
  it('finds whole words and phrases only', () => {
    expect(guessChoices('Banarasi Katan Silk Kadhua Butidar', DEFAULT_OPTIONS)).toEqual({ weaveStyle: 'Banarasi', technique: 'Kadhua', pattern: 'Butidar', work: '' });
    expect(guessChoices('Chanderi cotton silk with Zardozi Work and Aari Work', DEFAULT_OPTIONS)).toMatchObject({ weaveStyle: 'Chanderi', work: 'Zardozi Work, Aari Work' });
    expect(guessChoices('Mau Silk Butidar', DEFAULT_OPTIONS)).toEqual({ weaveStyle: '', technique: '', pattern: 'Butidar', work: '' });
  });

  it('does not take a word twice, and finds nothing in a name that has none of the choices', () => {
    expect(guessChoices('Jamdani Cotton', DEFAULT_OPTIONS)).toMatchObject({ weaveStyle: 'Jamdani', technique: '' });
    expect(guessChoices('Banarasi Jamdani', DEFAULT_OPTIONS)).toMatchObject({ weaveStyle: 'Banarasi', technique: 'Jamdani' });
    expect(guessChoices('Lalima', DEFAULT_OPTIONS)).toEqual({ weaveStyle: '', technique: '', pattern: '', work: '' });
    // "Plain" inside another word is not the pattern Plain.
    expect(guessChoices('Plainsman Saree', DEFAULT_OPTIONS).pattern).toBe('');
  });
});

describe('managing choices', () => {
  it('lists every choice with how many designs use it', async () => {
    const api = createApi(db);
    await api.inventoryQuickAdd(row({ technique: 'Dhaga Buti' }));
    await api.inventoryQuickAdd(row({ technique: 'Dhaga Buti', color: 'Wine' }));
    const entries = await api.catalogueEntries();
    expect(entries.find((e) => e.kind === 'technique' && e.label === 'Dhaga Buti')).toEqual({ kind: 'technique', label: 'Dhaga Buti', builtIn: false, uses: 1 });
    expect(entries.find((e) => e.kind === 'weaveStyle' && e.label === 'Banarasi')).toMatchObject({ builtIn: true, uses: 1 });
    expect(entries.find((e) => e.kind === 'colour' && e.label === 'Maroon')).toMatchObject({ uses: 1 });
  });

  it('renames a typo everywhere, and renames the designs whose names it built but not ones named by hand', async () => {
    const api = createApi(db);
    await api.inventoryQuickAdd(row({ technique: 'Dhagabuti' }));
    const hand = await api.designCreate(design('MG-900', 'Our Own Name', { technique: 'Dhagabuti' }));
    const result = await api.catalogueRename({ kind: 'technique', from: 'Dhagabuti', to: 'Dhaga Buti' });
    expect(result.changed).toBe(2);
    const designs = await api.designsList();
    expect(designs.map((d) => d.name).sort()).toEqual(['Banarasi Katan Silk Dhaga Buti Saree, Lalima', 'Our Own Name']);
    expect(designs.every((d) => d.technique === 'Dhaga Buti')).toBe(true);
    expect((await api.designGet(hand.id)).name).toBe('Our Own Name');
    const options = (await api.catalogueOptions()).technique;
    expect(options).toContain('Dhaga Buti');
    expect(options).not.toContain('Dhagabuti');
  });

  it('merges into a choice that already exists, and handles works in a list', async () => {
    const api = createApi(db);
    await api.inventoryQuickAdd(row({ work: 'Zardozi Work, Sona Chandi' }));
    await api.catalogueRename({ kind: 'work', from: 'Sona Chandi', to: 'Zardozi Work' });
    expect((await api.designsList())[0]).toMatchObject({ work: 'Zardozi Work', name: 'Banarasi Katan Silk Kadhua Saree with Zardozi Work, Lalima' });
  });

  it('renames a colour on its pieces, and refuses a merge that would give a design the same colour and size twice', async () => {
    const api = createApi(db);
    await api.inventoryQuickAdd(row({ color: 'Marun' }));
    await api.catalogueRename({ kind: 'colour', from: 'Marun', to: 'Maroon' });
    expect((await api.variantsForSale()).map((v) => v.color)).toEqual(['Maroon']);
    await api.inventoryQuickAdd(row({ color: 'Marun' }));
    await expect(api.catalogueRename({ kind: 'colour', from: 'Marun', to: 'Maroon' })).rejects.toThrow(/can't be merged/);
    expect((await api.variantsForSale()).map((v) => v.color).sort()).toEqual(['Marun', 'Maroon'].sort());
  });

  it('refuses to rename or remove a built in choice', async () => {
    const api = createApi(db);
    await expect(api.catalogueRename({ kind: 'weaveStyle', from: 'Banarasi', to: 'Benarasi' })).rejects.toThrow(/every shop starts with/);
    await expect(api.catalogueDelete({ kind: 'weaveStyle', label: 'banarasi' })).rejects.toThrow(/every shop starts with/);
  });

  it('removes a choice nobody uses, and refuses one that is in use', async () => {
    const api = createApi(db);
    await api.inventoryQuickAdd(row({ technique: 'Typo Buti' }));
    await expect(api.catalogueDelete({ kind: 'technique', label: 'Typo Buti' })).rejects.toThrow(/1 design uses/);
    await api.catalogueRename({ kind: 'technique', from: 'Typo Buti', to: 'Kadhua' });
    // The typo is gone from the lists now that nothing uses it.
    expect((await api.catalogueOptions()).technique).not.toContain('Typo Buti');
    await api.designCreate(design('MG-901', 'X', { technique: 'Spare Choice' }));
    await api.designUpdate((await api.designsList()).find((d) => d.code === 'MG-901')!.id, design('MG-901', 'X', { technique: '' }));
    await api.catalogueDelete({ kind: 'technique', label: 'Spare Choice' });
    expect((await api.catalogueOptions()).technique).not.toContain('Spare Choice');
  });
});

describe('tidying names', () => {
  it('sets the choices and renames the designs that were asked to be, and counts them', async () => {
    const api = createApi(db);
    const a = await api.designCreate(design('MG-1', 'Banarasi Katan Kadhua', { fabric: 'Katan Silk' }));
    const b = await api.designCreate(design('MG-2', 'Kept As Typed'));
    const result = await api.designsTidy([
      { id: a.id, weaveStyle: 'Banarasi', fabric: 'Katan Silk', technique: 'Kadhua', pattern: 'Jaal', work: '', nickname: 'Rang Bahar', rename: true },
      { id: b.id, weaveStyle: 'Chanderi', fabric: '', technique: '', pattern: '', work: '', nickname: '', rename: false },
    ]);
    expect(result).toEqual({ updated: 2, renamed: 1 });
    expect(await api.designGet(a.id)).toMatchObject({ name: 'Banarasi Katan Silk Kadhua Jaal Saree, Rang Bahar', weaveStyle: 'Banarasi', nickname: 'Rang Bahar' });
    expect(await api.designGet(b.id)).toMatchObject({ name: 'Kept As Typed', weaveStyle: 'Chanderi' });
  });

  it('changes nothing if any design has a problem, and says which', async () => {
    const api = createApi(db);
    const a = await api.designCreate(design('MG-1', 'First'));
    const b = await api.designCreate(design('MG-2', 'Second'));
    await expect(
      api.designsTidy([
        { id: a.id, weaveStyle: 'Banarasi', fabric: '', technique: '', pattern: '', work: '', nickname: '', rename: true },
        { id: b.id, weaveStyle: 'x'.repeat(41), fabric: '', technique: '', pattern: '', work: '', nickname: '', rename: true },
      ]),
    ).rejects.toThrow(/MG-2: Weave style is too long/);
    expect(await api.designGet(a.id)).toMatchObject({ name: 'First', weaveStyle: '' });
  });
});
