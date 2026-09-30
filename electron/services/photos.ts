import { MAX_PHOTOS_PER_DESIGN, MAX_PHOTO_BYTES, MAX_THUMB_BYTES, type DesignPhoto, type DesignPhotoInput } from '../../shared/catalogue';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso } from './common';
import { getDesign } from './inventory';

// Photos live in the database (so every backup and off-site copy carries them). The app shrinks a picture before sending it; here it is
// checked again, because a file is only trusted for what its first bytes say it is, not for what it claims to be.

type Mime = 'image/jpeg' | 'image/png' | 'image/webp';

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

function sniff(bytes: Buffer): Mime | null {
  if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function decode(dataUrl: unknown, label: string, maxBytes: number): { mime: Mime; bytes: Buffer } {
  const m = typeof dataUrl === 'string' ? DATA_URL.exec(dataUrl) : null;
  if (!m) throw new UserError(`The ${label} is not a JPEG, PNG or WebP picture.`);
  const bytes = Buffer.from(m[2]!, 'base64');
  const actual = sniff(bytes);
  if (!actual || actual !== m[1]) throw new UserError(`The ${label} is not really a ${m[1]!.replace('image/', '').toUpperCase()} picture.`);
  if (bytes.length > maxBytes) throw new UserError(`The ${label} is too large (${(bytes.length / 1024 / 1024).toFixed(1)} MB). Use a smaller picture.`);
  return { mime: actual, bytes };
}

const toUrl = (mime: string, blob: Uint8Array): string => `data:${mime};base64,${Buffer.from(blob).toString('base64')}`;

interface PhotoRow {
  id: string;
  design_id: string;
  position: number;
  mime: string;
  image: Uint8Array;
  thumb: Uint8Array;
}

const mapRow = (r: PhotoRow): DesignPhoto => ({ id: r.id, designId: r.design_id, position: r.position, image: toUrl(r.mime, r.image), thumb: toUrl(r.mime, r.thumb) });

export function listPhotos(db: Db, designId: string): DesignPhoto[] {
  return all<PhotoRow>(db, 'SELECT * FROM design_photos WHERE design_id = ? ORDER BY position', String(designId)).map(mapRow);
}

export function addPhoto(db: Db, designId: string, input: DesignPhotoInput): DesignPhoto[] {
  getDesign(db, designId); // also says so if the design is gone
  const image = decode(input?.image, 'photo', MAX_PHOTO_BYTES);
  const thumb = decode(input?.thumb, 'thumbnail', MAX_THUMB_BYTES);
  tx(db, () => {
    const count = get<{ n: number; top: number | null }>(db, 'SELECT COUNT(*) AS n, MAX(position) AS top FROM design_photos WHERE design_id = ?', designId)!;
    if (count.n >= MAX_PHOTOS_PER_DESIGN) throw new UserError(`A design can have ${MAX_PHOTOS_PER_DESIGN} photos. Remove one first.`);
    db.prepare('INSERT INTO design_photos (id, design_id, position, mime, image, thumb, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId(), designId, (count.top ?? -1) + 1, image.mime, image.bytes, thumb.bytes, nowIso());
  });
  return listPhotos(db, designId);
}

export function removePhoto(db: Db, photoId: string): { designId: string } {
  const row = get<{ design_id: string }>(db, 'SELECT design_id FROM design_photos WHERE id = ?', String(photoId));
  if (!row) throw new UserError('That photo is already gone.');
  tx(db, () => {
    run(db, 'DELETE FROM design_photos WHERE id = ?', photoId);
    // Close the gap, so there is always a cover (position 0) while any photo remains.
    all<{ id: string }>(db, 'SELECT id FROM design_photos WHERE design_id = ? ORDER BY position', row.design_id).forEach((p, i) => run(db, 'UPDATE design_photos SET position = ? WHERE id = ?', i, p.id));
  });
  return { designId: row.design_id };
}

/** Makes this photo the cover; the others keep their order behind it. */
export function setCover(db: Db, photoId: string): { designId: string } {
  const row = get<{ design_id: string }>(db, 'SELECT design_id FROM design_photos WHERE id = ?', String(photoId));
  if (!row) throw new UserError('That photo is gone.');
  tx(db, () => {
    const ids = all<{ id: string }>(db, 'SELECT id FROM design_photos WHERE design_id = ? ORDER BY position', row.design_id).map((p) => p.id);
    [photoId, ...ids.filter((id) => id !== photoId)].forEach((id, i) => run(db, 'UPDATE design_photos SET position = ? WHERE id = ?', i, id));
  });
  return { designId: row.design_id };
}

/** The small cover picture of every design that has photos, for the lists. */
export function coverThumbs(db: Db): Record<string, string> {
  const rows = all<{ design_id: string; mime: string; thumb: Uint8Array }>(
    db,
    'SELECT p.design_id, p.mime, p.thumb FROM design_photos p JOIN designs d ON d.id = p.design_id WHERE p.position = 0 AND d.deleted_at IS NULL',
  );
  return Object.fromEntries(rows.map((r) => [r.design_id, toUrl(r.mime, r.thumb)]));
}

/** The full size cover of each of these designs, for the catalogue. */
export function coverImages(db: Db, designIds: string[]): Map<string, string> {
  if (designIds.length === 0) return new Map();
  const rows = all<{ design_id: string; mime: string; image: Uint8Array }>(db, `SELECT design_id, mime, image FROM design_photos WHERE position = 0 AND design_id IN (${designIds.map(() => '?').join(',')})`, ...designIds);
  return new Map(rows.map((r) => [r.design_id, toUrl(r.mime, r.image)]));
}
