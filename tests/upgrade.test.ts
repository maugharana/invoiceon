import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, migrate } from '../electron/db/migrations';

/** The risk with a new migration is not an empty book but a real one: these build a book as it was, then upgrade it. */
function bookAtVersion7() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, 7);
  const now = '2026-09-01T10:00:00.000Z';
  db.exec(`
    INSERT INTO designs (id, code, name, created_at, updated_at) VALUES ('d1', 'MG-001', 'Butidar', '${now}', '${now}');
    INSERT INTO variants (id, design_id, sku, color, size, stock, base_cost_paise, sell_price_paise, mrp_paise, created_at, updated_at)
      VALUES ('v1', 'd1', 'MG-001-RED', 'Red', '6 m', 5, 40000, 100000, 120000, '${now}', '${now}'),
             ('v2', 'd1', 'MG-001-BLU', 'Blue', '6 m', 0, 50000, 90000, 0, '${now}', '${now}');
    INSERT INTO customers (id, name, type, phone, gstin, created_at, updated_at) VALUES ('c1', 'Sunita', 'B2C', '9876543210', '', '${now}', '${now}');
    INSERT INTO invoices (id, number, fy, seq, type, customer_id, seller_json, buyer_json, place_of_supply, issue_date, gst_rate_percent, intra_state, subtotal_paise, taxable_paise, total_paise, created_at, updated_at)
      VALUES ('i1', 'MG/2026-27/0001', '2026-27', 1, 'B2C', 'c1', '{}', '{}', 'Uttar Pradesh', '2026-09-01', 5, 1, 100000, 100000, 105000, '${now}', '${now}'),
             ('i2', 'MG/2026-27/0002', '2026-27', 2, 'B2C', 'c1', '{}', '{}', 'Uttar Pradesh', '2026-09-02', 5, 1, 100000, 100000, 105000, '${now}', '${now}');
    INSERT INTO proformas (id, number, fy, seq, type, customer_id, seller_json, buyer_json, place_of_supply, issue_date, valid_until, gst_rate_percent, intra_state, subtotal_paise, taxable_paise, total_paise, status, invoice_id, created_at, updated_at)
      VALUES ('p1', 'PF/2026-27/0001', '2026-27', 1, 'B2C', 'c1', '{}', '{}', 'Uttar Pradesh', '2026-08-30', '2026-09-15', 5, 1, 100000, 100000, 105000, 'converted', 'i1', '${now}', '2026-09-01T11:00:00.000Z'),
             ('p2', 'PF/2026-27/0002', '2026-27', 2, 'B2C', 'c1', '{}', '{}', 'Uttar Pradesh', '2026-08-31', '2026-09-20', 5, 1, 100000, 100000, 105000, 'open', NULL, '${now}', '${now}');
    INSERT INTO proforma_lines (id, proforma_id, variant_id, position, design_name, color, size, sku, qty, unit_price_paise, amount_paise)
      VALUES ('pl1', 'p1', 'v1', 0, 'Butidar', 'Red', '6 m', 'MG-001-RED', 3, 100000, 300000),
             ('pl2', 'p2', 'v1', 0, 'Butidar', 'Red', '6 m', 'MG-001-RED', 2, 100000, 200000);
  `);
  return db;
}

describe('upgrading a book that already has data', () => {
  it('reaches the latest version and keeps every row', () => {
    const db = bookAtVersion7();
    migrate(db);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(db.prepare('SELECT COUNT(*) AS n FROM invoices').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM variants').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 1 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it("starts each variant's price history with the prices it had", () => {
    const db = bookAtVersion7();
    migrate(db);
    const rows = db.prepare('SELECT variant_id, sell_price_paise, mrp_paise, base_cost_paise, changed_at FROM price_history ORDER BY variant_id').all();
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { variant_id: 'v1', sell_price_paise: 100000, mrp_paise: 120000, base_cost_paise: 40000, changed_at: '2026-09-01T10:00:00.000Z' },
      { variant_id: 'v2', sell_price_paise: 90000, mrp_paise: 0, base_cost_paise: 50000, changed_at: '2026-09-01T10:00:00.000Z' },
    ]);
  });

  it('records an already-invoiced quote as fully invoiced, and leaves an open one untouched', () => {
    const db = bookAtVersion7();
    migrate(db);
    expect(db.prepare('SELECT proforma_id, invoice_id FROM proforma_invoices').all().map((r) => ({ ...r }))).toEqual([{ proforma_id: 'p1', invoice_id: 'i1' }]);
    expect(db.prepare('SELECT id, invoiced_qty FROM proforma_lines ORDER BY id').all().map((r) => ({ ...r }))).toEqual([
      { id: 'pl1', invoiced_qty: 3 },
      { id: 'pl2', invoiced_qty: 0 },
    ]);
    expect(db.prepare('SELECT id, stage FROM proformas ORDER BY id').all().map((r) => ({ ...r }))).toEqual([
      { id: 'p1', stage: 'open' },
      { id: 'p2', stage: 'open' },
    ]);
  });

  it('gives existing invoices the plain series and no delivery, and still enforces unique numbers', () => {
    const db = bookAtVersion7();
    migrate(db);
    expect(db.prepare('SELECT series, delivery_status, ship_to_json FROM invoices').all().map((r) => ({ ...r }))).toEqual([
      { series: '', delivery_status: 'none', ship_to_json: '' },
      { series: '', delivery_status: 'none', ship_to_json: '' },
    ]);
    const now = '2026-09-03T10:00:00.000Z';
    const insert = (id: string, series: string, seq: number, number: string) =>
      db
        .prepare(
          `INSERT INTO invoices (id, number, fy, seq, series, type, seller_json, buyer_json, place_of_supply, issue_date, gst_rate_percent, intra_state, subtotal_paise, taxable_paise, total_paise, created_at, updated_at)
           VALUES (?, ?, '2026-27', ?, ?, 'B2C', '{}', '{}', 'UP', '2026-09-03', 5, 1, 1, 1, 1, ?, ?)`,
        )
        .run(id, number, seq, series, now, now);
    expect(() => insert('i3', '', 2, 'MG/2026-27/0003')).toThrow(/UNIQUE/); // sequence 2 in the plain series is taken
    expect(() => insert('i4', 'B2B', 1, 'MGB/2026-27/0001')).not.toThrow(); // but a separate series has its own sequence
    expect(() => insert('i5', 'B2B', 1, 'MGB/2026-27/0002')).toThrow(/UNIQUE/);
  });

  it('adds the new customer and design fields with safe defaults', () => {
    const db = bookAtVersion7();
    migrate(db);
    const c = db.prepare('SELECT tags, credit_limit_paise, payment_terms_days, birthday, anniversary, addresses_json, contacts_json FROM customers').get();
    expect({ ...c }).toEqual({ tags: '', credit_limit_paise: 0, payment_terms_days: null, birthday: '', anniversary: '', addresses_json: '[]', contacts_json: '[]' });
    expect({ ...db.prepare('SELECT tags FROM designs').get() }).toEqual({ tags: '' });
  });

  it('can be run again without changing anything', () => {
    const db = bookAtVersion7();
    migrate(db);
    const before = { ...db.prepare('SELECT COUNT(*) AS n FROM price_history').get() };
    migrate(db);
    expect({ ...db.prepare('SELECT COUNT(*) AS n FROM price_history').get() }).toEqual(before);
  });
});
