import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import type { Business, BusinessList } from '../shared/business';
import { openDb } from './db/connection';
import { UserError } from './services/common';
import { saveSettings } from './services/settings';

// One installation, several businesses, each with its own database, backups, users, off-site copies and numbering, so nothing in one can leak into
// another. The original business stays exactly where it always was (the app's data folder); each one added later lives in its own folder beneath
// `businesses/`. A small JSON file in the data folder lists them and says which is open.

const FILE = 'businesses.json';
const MAIN_ID = 'main';

interface Registry {
  active: string;
  businesses: { id: string; name: string; folder: string | null }[]; // folder is relative to the data folder; null means the data folder itself
}

const registryPath = (dataDir: string) => join(dataDir, FILE);

function read(dataDir: string): Registry {
  const fallback: Registry = { active: MAIN_ID, businesses: [{ id: MAIN_ID, name: 'My business', folder: null }] };
  try {
    const parsed = JSON.parse(readFileSync(registryPath(dataDir), 'utf8')) as Registry;
    const valid = Array.isArray(parsed.businesses) && parsed.businesses.length > 0 && parsed.businesses.every((b) => typeof b.id === 'string' && typeof b.name === 'string' && (b.folder === null || (typeof b.folder === 'string' && /^businesses\/[0-9a-f]{8}$/.test(b.folder))));
    if (!valid || !parsed.businesses.some((b) => b.id === parsed.active)) throw new Error('bad registry');
    return parsed;
  } catch (err) {
    // No file yet (first run) is normal. A damaged one is set aside, never overwritten silently, and the app carries on with the main business.
    if (existsSync(registryPath(dataDir))) {
      try {
        renameSync(registryPath(dataDir), join(dataDir, `businesses.damaged-${Date.now()}.json`));
      } catch {
        /* leave it */
      }
    }
    return fallback;
  }
}

function write(dataDir: string, registry: Registry): void {
  mkdirSync(dataDir, { recursive: true });
  const tmp = `${registryPath(dataDir)}.tmp`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2));
  renameSync(tmp, registryPath(dataDir)); // a list is either the old one or the new one, never half of one
}

/** Where a business keeps its files. Checked to be inside the data folder, whatever the registry file says. */
export function businessDir(dataDir: string, b: { folder: string | null }): string {
  if (b.folder === null) return dataDir;
  const dir = resolve(dataDir, b.folder);
  if (!dir.startsWith(resolve(dataDir) + sep)) throw new UserError('That business points outside the data folder.');
  return dir;
}

const shape = (dataDir: string, r: Registry): BusinessList => ({
  activeId: r.active,
  businesses: r.businesses.map((b): Business => ({ id: b.id, name: b.name, active: b.id === r.active, dir: businessDir(dataDir, b) })),
});

/**
 * The list. When the name the open business gives itself (in its own settings) has changed, the list follows, so the two never disagree;
 * if another business already has that name the list keeps its own, rather than showing two the same.
 */
export function listBusinesses(dataDir: string, activeName?: string): BusinessList {
  const registry = read(dataDir);
  const name = activeName?.trim().replace(/\s+/g, ' ');
  const current = registry.businesses.find((b) => b.id === registry.active)!;
  if (name && name.length <= 60 && name !== current.name && !registry.businesses.some((b) => b.id !== current.id && b.name.toLowerCase() === name.toLowerCase())) {
    current.name = name;
    write(dataDir, registry);
  }
  return shape(dataDir, registry);
}

/** The folder of the business that is open. */
export function activeBusiness(dataDir: string): Business {
  const list = listBusinesses(dataDir);
  return list.businesses.find((b) => b.active)!;
}

function cleanName(name: unknown, registry: Registry, exceptId?: string): string {
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!n) throw new UserError('Enter a name for the business.');
  if (n.length > 60) throw new UserError('Keep the name to 60 characters or fewer.');
  if (registry.businesses.some((b) => b.id !== exceptId && b.name.toLowerCase() === n.toLowerCase())) throw new UserError(`You already have a business called "${n}".`);
  return n;
}

/** Makes the new business's own database, named from the start, and adds it to the list. It does not switch to it. */
export function addBusiness(dataDir: string, name: string): Business {
  const registry = read(dataDir);
  const clean = cleanName(name, registry);
  if (registry.businesses.length >= 12) throw new UserError('Twelve businesses is the most one installation keeps. Remove one from the list first.');
  const id = randomBytes(4).toString('hex');
  const folder = `businesses/${id}`;
  const dir = businessDir(dataDir, { folder });
  mkdirSync(dir, { recursive: true });
  const db = openDb(join(dir, 'invoiceon.db'));
  try {
    saveSettings(db, { businessName: clean });
  } finally {
    db.close();
  }
  registry.businesses.push({ id, name: clean, folder });
  write(dataDir, registry);
  return shape(dataDir, registry).businesses.find((b) => b.id === id)!;
}

export function renameBusiness(dataDir: string, id: string, name: string): BusinessList {
  const registry = read(dataDir);
  const b = registry.businesses.find((x) => x.id === id);
  if (!b) throw new UserError('That business is not on the list.');
  b.name = cleanName(name, registry, id);
  write(dataDir, registry);
  return shape(dataDir, registry);
}

export function setActiveBusiness(dataDir: string, id: string): BusinessList {
  const registry = read(dataDir);
  if (!registry.businesses.some((x) => x.id === id)) throw new UserError('That business is not on the list.');
  registry.active = id;
  write(dataDir, registry);
  return shape(dataDir, registry);
}

/**
 * Takes a business off the list. Its files are never deleted: they stay in their folder, and this only stops the app offering it, so a mistake is
 * recoverable by a person who can copy a folder. The business that is open, and the original one, cannot be removed.
 */
export function unlistBusiness(dataDir: string, id: string): BusinessList {
  const registry = read(dataDir);
  if (id === MAIN_ID) throw new UserError('The original business cannot be removed from the list.');
  if (id === registry.active) throw new UserError('Switch to another business first. The one that is open cannot be removed from the list.');
  if (!registry.businesses.some((x) => x.id === id)) throw new UserError('That business is not on the list.');
  registry.businesses = registry.businesses.filter((x) => x.id !== id);
  write(dataDir, registry);
  return shape(dataDir, registry);
}
