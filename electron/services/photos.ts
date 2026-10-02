import { MAX_PHOTOS_PER_DESIGN, type DesignPhoto, type DesignPhotoInput } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso } from './common';
import { getDesign } from './inventory';

/** The screen shrinks a photo to about 700 pixels before it is sent; these are generous ceilings that catch a photo that was not shrunk. */
const MAX_DATA_CHARS = 450_000;
const MAX_THUMB_CHARS = 40_000;
const IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

function check(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !IMAGE_URL.test(value)) throw new UserError(`${label} must be a JPEG, PNG or WebP image.`);
  if (value.length > max) throw new UserError(`${label} is too large. Choose a smaller photo.`);
  return value;
}

interface Row {
  id: string;
  design_id: string;
  position: number;
  data: string;
}

const toPhoto = (r: Row): DesignPhoto => ({ id: r.id, designId: r.design_id, position: r.position, dataUrl: r.data });

export function listPhotos(db: Db, designId: string): DesignPhoto[] {
  return all<Row>(db, 'SELECT id, design_id, position, data FROM design_photos WHERE design_id = ? AND deleted_at IS NULL ORDER BY position, created_at', designId).map(toPhoto);
}

/** The cover of each design, as its thumbnail. */
export function covers(db: Db): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of all<{ design_id: string; thumb: string }>(db, 'SELECT design_id, thumb FROM design_photos WHERE deleted_at IS NULL ORDER BY position DESC, created_at DESC')) out[r.design_id] = r.thumb;
  return out;
}

export function addPhoto(db: Db, designId: string, input: DesignPhotoInput): DesignPhoto[] {
  getDesign(db, designId);
  const data = check(input?.dataUrl, 'The photo', MAX_DATA_CHARS);
  const thumb = check(input?.thumbUrl, 'The small copy of the photo', MAX_THUMB_CHARS);
  const have = listPhotos(db, designId).length;
  if (have >= MAX_PHOTOS_PER_DESIGN) throw new UserError(`A design can have up to ${MAX_PHOTOS_PER_DESIGN} photos. Remove one first.`);
  const position = (get<{ n: number }>(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM design_photos WHERE design_id = ? AND deleted_at IS NULL', designId)?.n ?? 0);
  run(db, 'INSERT INTO design_photos (id, design_id, position, data, thumb, created_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), designId, position, data, thumb, nowIso());
  return listPhotos(db, designId);
}

function designOf(db: Db, photoId: string): string {
  const r = get<{ design_id: string }>(db, 'SELECT design_id FROM design_photos WHERE id = ? AND deleted_at IS NULL', photoId);
  if (!r) throw new UserError('That photo no longer exists.');
  return r.design_id;
}

/** Removes a photo from view; the rest keep their order, with the next one becoming the cover if it was the cover. */
export function removePhoto(db: Db, photoId: string): DesignPhoto[] {
  const designId = designOf(db, photoId);
  tx(db, () => {
    run(db, 'UPDATE design_photos SET deleted_at = ? WHERE id = ?', nowIso(), photoId);
    listPhotos(db, designId).forEach((p, i) => run(db, 'UPDATE design_photos SET position = ? WHERE id = ?', i, p.id));
  });
  return listPhotos(db, designId);
}

export function setCover(db: Db, photoId: string): DesignPhoto[] {
  const designId = designOf(db, photoId);
  tx(db, () => {
    const order = [photoId, ...listPhotos(db, designId).map((p) => p.id).filter((id) => id !== photoId)];
    order.forEach((id, i) => run(db, 'UPDATE design_photos SET position = ? WHERE id = ?', i, id));
  });
  return listPhotos(db, designId);
}
