import type { Material, MaterialInput } from '../../shared/types';
import { all, get, run, type Db } from '../db/connection';
import { UserError, isUniqueViolation, newId, nowIso, requireInt, requireText } from './common';

interface MaterialRow {
  id: string;
  name: string;
  unit: string;
  unit_cost_paise: number;
  used_in: number;
}

const SELECT = `
  SELECT m.id, m.name, m.unit, m.unit_cost_paise,
    (SELECT COUNT(*) FROM variant_materials vm JOIN variants v ON v.id = vm.variant_id AND v.deleted_at IS NULL WHERE vm.material_id = m.id) AS used_in
  FROM raw_materials m WHERE m.deleted_at IS NULL`;

const toMaterial = (r: MaterialRow): Material => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  unitCostPaise: r.unit_cost_paise,
  usedInCount: r.used_in,
});

function validate(input: MaterialInput) {
  return {
    name: requireText(input.name, 'Material name'),
    unit: requireText(input.unit, 'Unit', 20),
    unitCostPaise: requireInt(input.unitCostPaise, 'Cost per unit', { max: 100_000_000_00 }),
  };
}

export function listMaterials(db: Db): Material[] {
  return all<MaterialRow>(db, `${SELECT} ORDER BY m.name COLLATE NOCASE`).map(toMaterial);
}

export function getMaterial(db: Db, id: string): Material {
  const row = get<MaterialRow>(db, `${SELECT} AND m.id = ?`, id);
  if (!row) throw new UserError('That material no longer exists.');
  return toMaterial(row);
}

export function createMaterial(db: Db, input: MaterialInput): Material {
  const v = validate(input);
  const id = newId();
  const now = nowIso();
  try {
    run(db, 'INSERT INTO raw_materials (id, name, unit, unit_cost_paise, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, v.name, v.unit, v.unitCostPaise, now, now);
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(`A material named "${v.name}" already exists.`);
    throw err;
  }
  return getMaterial(db, id);
}

export function updateMaterial(db: Db, id: string, input: MaterialInput): Material {
  const v = validate(input);
  getMaterial(db, id);
  try {
    run(db, 'UPDATE raw_materials SET name = ?, unit = ?, unit_cost_paise = ?, updated_at = ? WHERE id = ?', v.name, v.unit, v.unitCostPaise, nowIso(), id);
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(`A material named "${v.name}" already exists.`);
    throw err;
  }
  return getMaterial(db, id);
}

export function deleteMaterial(db: Db, id: string): void {
  const material = getMaterial(db, id);
  if (material.usedInCount > 0) {
    const n = material.usedInCount;
    throw new UserError(`"${material.name}" is used in the costing of ${n} variant${n === 1 ? '' : 's'}. Remove it from those first.`);
  }
  run(db, 'UPDATE raw_materials SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}
