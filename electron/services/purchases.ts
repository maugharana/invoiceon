import { isIsoDate, todayIso } from '../../shared/gst';
import { mulPaise } from '../../shared/money';
import { matchesAll } from '../../shared/search';
import type { Purchase, PurchaseInput, PurchaseResult, PurchaseSummary } from '../../shared/types';
import { all, get, run, tx, type Db } from '../db/connection';
import { UserError, newId, nowIso, optionalText, requireInt } from './common';
import { createExpense, deleteExpense } from './expenses';
import { getMaterial, recordMaterialMovement, roundQty, setPriceFromPurchase } from './materials';

const MAX_PAISE = 100_000_000_00;
/** The category a bought-in material goes under when the purchase is also entered as an expense. */
export const PURCHASE_CATEGORY = 'Raw materials';

interface Row {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  purchase_date: string;
  bill_no: string;
  note: string;
  total_paise: number;
  gst_paise: number;
  expense_id: string | null;
  line_count: number;
}

const SELECT = `
  SELECT p.*, s.name AS supplier_name, (SELECT COUNT(*) FROM purchase_lines l WHERE l.purchase_id = p.id) AS line_count
  FROM purchases p LEFT JOIN vendors s ON s.id = p.supplier_id WHERE p.deleted_at IS NULL`;

const toSummary = (r: Row): PurchaseSummary => ({ id: r.id, date: r.purchase_date, supplierId: r.supplier_id, supplierName: r.supplier_name ?? '', billNo: r.bill_no, totalPaise: r.total_paise, gstPaise: r.gst_paise, lineCount: r.line_count, expenseId: r.expense_id });

export function listPurchases(db: Db, query: { from?: string; to?: string; supplierId?: string; search?: string } = {}): PurchaseSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (query.from) {
    where.push('p.purchase_date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('p.purchase_date <= ?');
    params.push(query.to);
  }
  if (query.supplierId) {
    where.push('p.supplier_id = ?');
    params.push(query.supplierId);
  }
  return all<Row>(db, `${SELECT} ${where.map((w) => `AND ${w}`).join(' ')} ORDER BY p.purchase_date DESC, p.created_at DESC`, ...params)
    .map(toSummary)
    .filter((p) => matchesAll(`${p.supplierName} ${p.billNo}`, query.search));
}

export function getPurchase(db: Db, id: string): Purchase {
  const row = get<Row>(db, `${SELECT} AND p.id = ?`, id);
  if (!row) throw new UserError('That purchase no longer exists.');
  const lines = all<{ material_id: string; name: string; unit: string; qty: number; unit_cost_paise: number; amount_paise: number }>(
    db,
    `SELECT l.material_id, m.name, m.unit, l.qty, l.unit_cost_paise, l.amount_paise
     FROM purchase_lines l JOIN raw_materials m ON m.id = l.material_id WHERE l.purchase_id = ? ORDER BY l.position`,
    id,
  ).map((l) => ({ materialId: l.material_id, materialName: l.name, unit: l.unit, qty: l.qty, unitCostPaise: l.unit_cost_paise, amountPaise: l.amount_paise }));
  return { ...toSummary(row), note: row.note, lines };
}

/**
 * Records buying raw material. The quantities go into stock, each material's price becomes the price just paid (and the old price
 * stays in its history), and — if asked — the bill is also entered as an expense so it counts in profit, in the account it was
 * paid from, and in the input GST. Everything happens together or not at all.
 */
export function createPurchase(db: Db, input: PurchaseInput): PurchaseResult {
  if (!isIsoDate(input.date) || input.date > todayIso()) throw new UserError('Enter the day you bought it, not in the future.');
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new UserError('Add at least one material.');
  if (input.lines.length > 50) throw new UserError('A purchase can have at most 50 materials.');
  const supplier = input.supplierId ? get<{ id: string; name: string }>(db, 'SELECT id, name FROM vendors WHERE id = ? AND deleted_at IS NULL', input.supplierId) : null;
  if (input.supplierId && !supplier) throw new UserError('That supplier no longer exists.');

  const seen = new Set<string>();
  const lines = input.lines.map((l) => {
    if (seen.has(l.materialId)) throw new UserError('The same material is listed twice — combine them into one line.');
    seen.add(l.materialId);
    const qty = roundQty(l.qty);
    if (typeof l.qty !== 'number' || !Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) throw new UserError('Each material needs a quantity greater than zero.');
    const unitCostPaise = requireInt(l.unitCostPaise, 'The price per unit', { max: MAX_PAISE });
    return { materialId: l.materialId, qty, unitCostPaise, amountPaise: mulPaise(qty, unitCostPaise), material: getMaterial(db, l.materialId) };
  });
  const total = lines.reduce((s, l) => s + l.amountPaise, 0);
  const gst = input.gstPaise ? requireInt(input.gstPaise, 'GST', { max: MAX_PAISE }) : 0;
  if (gst > total) throw new UserError("The GST can't be more than the total of the bill.");
  const billNo = optionalText(input.billNo, 'Bill number', 40);
  const note = optionalText(input.note, 'Note', 200);

  const id = newId();
  const priceChanges: PurchaseResult['priceChanges'] = [];
  tx(db, () => {
    let expenseId: string | null = null;
    if (input.expense) {
      expenseId = createExpense(db, {
        date: input.date,
        category: PURCHASE_CATEGORY,
        vendor: supplier?.name ?? '',
        amountPaise: total,
        gstPaise: gst,
        method: input.expense.method,
        accountId: input.expense.accountId,
        reference: billNo,
        note: note || `${lines.length} ${lines.length === 1 ? 'material' : 'materials'} bought`,
        status: input.expense.status,
        dueDate: input.expense.dueDate ?? null,
      }).id;
    }
    run(db, 'INSERT INTO purchases (id, supplier_id, purchase_date, bill_no, note, total_paise, gst_paise, expense_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, supplier?.id ?? null, input.date, billNo, note, total, gst, expenseId, nowIso());
    lines.forEach((l, i) => {
      run(db, 'INSERT INTO purchase_lines (id, purchase_id, material_id, position, qty, unit_cost_paise, amount_paise) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), id, l.materialId, i, l.qty, l.unitCostPaise, l.amountPaise);
      recordMaterialMovement(db, l.materialId, l.qty, 'purchase', billNo ? `Bill ${billNo}` : 'Purchase', { type: 'purchase', id });
      const before = l.material.unitCostPaise;
      if (setPriceFromPurchase(db, l.materialId, l.unitCostPaise)) priceChanges.push({ materialId: l.materialId, materialName: l.material.name, fromPaise: before, toPaise: l.unitCostPaise });
    });
  });
  return { ...getPurchase(db, id), priceChanges };
}

/**
 * Takes a purchase back out (it was entered by mistake). The stock it added comes out again, which only works while that stock is
 * still there, and the expense it made is deleted. Prices are not rolled back: the price history keeps what was paid.
 */
export function deletePurchase(db: Db, id: string): void {
  const p = getPurchase(db, id);
  tx(db, () => {
    for (const l of p.lines) recordMaterialMovement(db, l.materialId, -l.qty, 'adjustment', `Purchase ${p.billNo || p.date} removed`, { type: 'purchase', id });
    if (p.expenseId) deleteExpense(db, p.expenseId);
    run(db, 'UPDATE purchases SET deleted_at = ? WHERE id = ?', nowIso(), id);
  });
}
