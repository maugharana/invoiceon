import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { MAX_PHOTOS_PER_DESIGN } from '../shared/types';

let db: Db;
let api: ReturnType<typeof createApi>;
let designId: string;

beforeEach(async () => {
  db = openDb(':memory:');
  api = createApi(db);
  designId = (await api.designCreate({ code: 'MG-1', name: 'Butidar', fabric: '', hsnCode: '', description: '', defaultPricePaise: 0 })).id;
});

const image = (tag: string) => ({ dataUrl: `data:image/jpeg;base64,/9j/4AAQSkZJRg${tag}==`, thumbUrl: `data:image/jpeg;base64,/9j/${tag}==` });

describe('design photos', () => {
  it('keeps photos in the order added, the first being the cover', async () => {
    await api.designPhotoAdd(designId, image('AAA'));
    const photos = await api.designPhotoAdd(designId, image('BBB'));
    expect(photos.map((p) => p.position)).toEqual([0, 1]);
    expect(photos[0]!.dataUrl).toContain('AAA');
    expect((await api.designCovers())[designId]).toContain('AAA');
  });

  it('makes another photo the cover, keeping the rest in order', async () => {
    await api.designPhotoAdd(designId, image('AAA'));
    await api.designPhotoAdd(designId, image('BBB'));
    const three = await api.designPhotoAdd(designId, image('CCC'));
    const made = await api.designPhotoCover(three[2]!.id);
    expect(made[0]!.dataUrl).toContain('CCC');
    expect(made[1]!.dataUrl).toContain('AAA');
    expect(made[2]!.dataUrl).toContain('BBB');
    expect((await api.designCovers())[designId]).toContain('CCC');
  });

  it('removes a photo and closes the gap, so the next one becomes the cover', async () => {
    const two = await api.designPhotoAdd(designId, image('AAA')).then(() => api.designPhotoAdd(designId, image('BBB')));
    const left = await api.designPhotoRemove(two[0]!.id);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ position: 0 });
    expect(left[0]!.dataUrl).toContain('BBB');
    expect((await api.designCovers())[designId]).toContain('BBB');
    await api.designPhotoRemove(left[0]!.id);
    expect(await api.designCovers()).toEqual({});
  });

  it('allows a few photos only, and room comes back when one is removed', async () => {
    let last = await api.designPhotoAdd(designId, image('A0'));
    for (let i = 1; i < MAX_PHOTOS_PER_DESIGN; i++) last = await api.designPhotoAdd(designId, image(`A${i}`));
    await expect(api.designPhotoAdd(designId, image('ZZ'))).rejects.toThrow(/up to 4 photos/);
    await api.designPhotoRemove(last[0]!.id);
    expect(await api.designPhotoAdd(designId, image('ZZ'))).toHaveLength(MAX_PHOTOS_PER_DESIGN);
  });

  it('accepts only images of a sensible size', async () => {
    await expect(api.designPhotoAdd(designId, { dataUrl: 'data:text/html;base64,PGI+', thumbUrl: 'data:image/jpeg;base64,AAAA' })).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(api.designPhotoAdd(designId, { dataUrl: 'javascript:alert(1)', thumbUrl: 'x' })).rejects.toThrow(/JPEG, PNG or WebP/);
    const big = 'A'.repeat(460_000);
    await expect(api.designPhotoAdd(designId, { dataUrl: `data:image/png;base64,${big}`, thumbUrl: 'data:image/png;base64,AAAA' })).rejects.toThrow(/too large/);
    await expect(api.designPhotoAdd(designId, { dataUrl: 'data:image/png;base64,AAAA', thumbUrl: `data:image/png;base64,${'A'.repeat(50_000)}` })).rejects.toThrow(/too large/);
    await expect(api.designPhotoAdd('nobody', image('AAA'))).rejects.toThrow();
    expect(await api.designPhotos(designId)).toEqual([]);
  });
});
