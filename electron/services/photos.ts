import type { Photo, PhotoInput, PhotoOwner } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso } from './common';

// Pictures live inside the book (as small compressed JPEGs the screen makes before sending), so a backup always holds them
// and a restore can never leave pictures behind. Each photo is kept twice: a picture to look at and a tiny one for lists.

const MAX_IMAGE_BYTES = 450_000;
const MAX_THUMB_BYTES = 40_000;
const MAX_PER_OWNER: Record<PhotoOwner, number> = { design: 10, variant: 6, expense: 4 };
const OWNER_TABLE: Record<PhotoOwner, string> = { design: 'designs', variant: 'variants', expense: 'expenses' };

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

function decode(dataUrl: unknown, label: string, max: number): { mime: string; bytes: Buffer } {
  const m = typeof dataUrl === 'string' ? DATA_URL.exec(dataUrl) : null;
  if (!m) throw new UserError(`The ${label} must be a JPEG, PNG or WebP picture.`);
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length === 0) throw new UserError(`The ${label} is empty.`);
  if (bytes.length > max) throw new UserError(`That picture is too large (${Math.round(bytes.length / 1024)} KB). Try a smaller one.`);
  return { mime: m[1]!, bytes };
}

const toUrl = (mime: string, bytes: Uint8Array | null): string => (bytes ? `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` : '');

function checkOwner(db: Db, type: PhotoOwner, id: string): void {
  if (!(type in OWNER_TABLE)) throw new UserError('Pictures can be added to a design, a colour or an expense.');
  const ok = get(db, `SELECT 1 AS x FROM ${OWNER_TABLE[type]} WHERE id = ? AND deleted_at IS NULL`, id);
  if (!ok) throw new UserError('That item no longer exists.');
}

interface Row {
  id: string;
  owner_type: PhotoOwner;
  owner_id: string;
  mime: string;
  thumb: Uint8Array | null;
  bytes: number;
  position: number;
  created_at: string;
}

const toPhoto = (r: Row): Photo => ({ id: r.id, ownerType: r.owner_type, ownerId: r.owner_id, thumb: toUrl(r.mime, r.thumb), bytes: r.bytes, position: r.position, createdAt: r.created_at });

/** Pictures of one thing, cover first. Only the tiny versions are sent; ask for one picture to see it full size. */
export function listPhotos(db: Db, type: PhotoOwner, ownerId: string): Photo[] {
  return all<Row>(db, 'SELECT id, owner_type, owner_id, mime, thumb, bytes, position, created_at FROM photos WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY position, created_at', type, ownerId).map(toPhoto);
}

export function getPhotoImage(db: Db, id: string): string {
  const r = get<{ mime: string; image: Uint8Array | null }>(db, 'SELECT mime, image FROM photos WHERE id = ? AND deleted_at IS NULL', id);
  if (!r?.image) throw new UserError('That picture no longer exists.');
  return toUrl(r.mime, r.image);
}

export function addPhoto(db: Db, input: PhotoInput): Photo {
  checkOwner(db, input.ownerType, input.ownerId);
  const image = decode(input.image, 'picture', MAX_IMAGE_BYTES);
  const thumb = decode(input.thumb, 'small picture', MAX_THUMB_BYTES);
  const id = newId();
  tx(db, () => {
    const count = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM photos WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL', input.ownerType, input.ownerId)!.n;
    if (count >= MAX_PER_OWNER[input.ownerType]) throw new UserError(`Up to ${MAX_PER_OWNER[input.ownerType]} pictures can be kept here. Remove one first.`);
    const next = (get<{ p: number | null }>(db, 'SELECT MAX(position) AS p FROM photos WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL', input.ownerType, input.ownerId)?.p ?? -1) + 1;
    // The shared helper takes only text and numbers; the pictures are binary.
    db.prepare('INSERT INTO photos (id, owner_type, owner_id, mime, image, thumb, bytes, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, input.ownerType, input.ownerId, image.mime, image.bytes, thumb.bytes, image.bytes.length + thumb.bytes.length, next, nowIso());
  });
  return toPhoto(get<Row>(db, 'SELECT id, owner_type, owner_id, mime, thumb, bytes, position, created_at FROM photos WHERE id = ?', id)!);
}

/** The picture goes; the row stays (so the history is intact) but its bytes are dropped. */
export function deletePhoto(db: Db, id: string): void {
  if (!get(db, 'SELECT 1 AS x FROM photos WHERE id = ? AND deleted_at IS NULL', id)) throw new UserError('That picture no longer exists.');
  run(db, 'UPDATE photos SET deleted_at = ?, image = NULL, thumb = NULL, bytes = 0 WHERE id = ?', nowIso(), id);
}

/** Makes this picture the first one, which is the one shown in lists. */
export function setCover(db: Db, id: string): Photo[] {
  const p = get<{ owner_type: PhotoOwner; owner_id: string }>(db, 'SELECT owner_type, owner_id FROM photos WHERE id = ? AND deleted_at IS NULL', id);
  if (!p) throw new UserError('That picture no longer exists.');
  tx(db, () => {
    const order = all<{ id: string }>(db, 'SELECT id FROM photos WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY position, created_at', p.owner_type, p.owner_id).map((r) => r.id);
    [id, ...order.filter((x) => x !== id)].forEach((pid, i) => run(db, 'UPDATE photos SET position = ? WHERE id = ?', i, pid));
  });
  return listPhotos(db, p.owner_type, p.owner_id);
}

/**
 * The first small picture for each of the given things, for lists and grids. A design with no picture of its own shows its first
 * colour's. Things with no picture are simply absent.
 */
export function coverThumbs(db: Db, type: PhotoOwner, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const list = [...new Set(ids)].slice(0, 500);
  if (list.length === 0) return out;
  const first = (ownerType: PhotoOwner, owners: string[], map: (ownerId: string) => string) => {
    if (owners.length === 0) return;
    const m = owners.map(() => '?').join(',');
    for (const r of all<{ owner_id: string; mime: string; thumb: Uint8Array }>(
      db,
      `SELECT p.owner_id, p.mime, p.thumb FROM photos p WHERE p.owner_type = ? AND p.owner_id IN (${m}) AND p.deleted_at IS NULL AND p.thumb IS NOT NULL
       AND p.position = (SELECT MIN(q.position) FROM photos q WHERE q.owner_type = p.owner_type AND q.owner_id = p.owner_id AND q.deleted_at IS NULL)`,
      ownerType,
      ...owners,
    )) {
      const key = map(r.owner_id);
      if (!(key in out)) out[key] = toUrl(r.mime, r.thumb);
    }
  };
  first(type, list, (o) => o);
  if (type === 'design') {
    // Fall back to a colour's picture for designs without one of their own.
    const missing = list.filter((d) => !(d in out));
    if (missing.length > 0) {
      const m = missing.map(() => '?').join(',');
      const variants = all<{ id: string; design_id: string }>(db, `SELECT id, design_id FROM variants WHERE design_id IN (${m}) AND deleted_at IS NULL ORDER BY created_at`, ...missing);
      const owner = new Map(variants.map((v) => [v.id, v.design_id]));
      first('variant', variants.map((v) => v.id), (vid) => owner.get(vid)!);
    }
  }
  return out;
}
