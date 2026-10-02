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

describe('upgrading a book from before accounts, vendors and input GST', () => {
  function bookAtVersion10() {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, 10);
    const now = '2026-09-01T10:00:00.000Z';
    db.exec(`
      INSERT INTO customers (id, name, type, phone, gstin, created_at, updated_at) VALUES ('c1', 'Sunita', 'B2C', '9876543210', '', '${now}', '${now}');
      INSERT INTO payments (id, customer_id, amount_paise, method, received_on, created_at, updated_at) VALUES ('pay1', 'c1', 50000, 'upi', '2026-09-01', '${now}', '${now}');
      INSERT INTO expenses (id, expense_date, category, vendor, amount_paise, method, created_at, updated_at)
        VALUES ('e1', '2026-08-10', 'Rent', 'Sharma Traders', 100000, 'bank', '${now}', '${now}'),
               ('e2', '2026-08-20', 'Packaging', 'sharma traders', 20000, 'cash', '${now}', '${now}'),
               ('e3', '2026-08-25', 'Tea', '', 5000, 'cash', '${now}', '${now}'),
               ('e4', '2026-08-26', 'Fuel', 'Gupta', 7000, 'cash', '${now}', '${now}');
    `);
    return db;
  }

  it('turns every name typed under "Paid to" into one vendor, spelt as first entered, and links the expenses', () => {
    const db = bookAtVersion10();
    migrate(db);
    const vendors = db.prepare('SELECT name FROM vendors ORDER BY name').all().map((r) => (r as { name: string }).name);
    expect(vendors).toEqual(['Gupta', 'Sharma Traders']);
    const linked = db.prepare('SELECT e.id, v.name FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id ORDER BY e.id').all().map((r) => ({ ...r }));
    expect(linked).toEqual([
      { id: 'e1', name: 'Sharma Traders' },
      { id: 'e2', name: 'Sharma Traders' },
      { id: 'e3', name: null },
      { id: 'e4', name: 'Gupta' },
    ]);
  });

  it('marks existing expenses paid on their own date, with no GST, and existing payments as plain receipts', () => {
    const db = bookAtVersion10();
    migrate(db);
    const e = db.prepare("SELECT status, paid_on, gst_paise, account_id, due_date FROM expenses WHERE id = 'e1'").get();
    expect({ ...e }).toEqual({ status: 'paid', paid_on: '2026-08-10', gst_paise: 0, account_id: '', due_date: null });
    const p = db.prepare("SELECT kind, account_id, cheque_status, reconciled_on FROM payments WHERE id = 'pay1'").get();
    expect({ ...p }).toEqual({ kind: 'receipt', account_id: '', cheque_status: null, reconciled_on: null });
  });
});

describe('upgrading a book from before raw-material stock and places', () => {
  function bookAtVersion11() {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, 11);
    const now = '2026-09-01T10:00:00.000Z';
    db.exec(`
      INSERT INTO raw_materials (id, name, unit, unit_cost_paise, created_at, updated_at) VALUES ('m1', 'Silk yarn', 'kg', 460000, '${now}', '${now}');
      INSERT INTO designs (id, code, name, created_at, updated_at) VALUES ('d1', 'MG-001', 'Butidar', '${now}', '${now}');
      INSERT INTO variants (id, design_id, sku, color, size, stock, created_at, updated_at) VALUES ('v1', 'd1', 'MG-001-RED', 'Red', '6 m', 7, '${now}', '${now}');
      INSERT INTO variant_materials (variant_id, material_id, qty) VALUES ('v1', 'm1', 0.62);
    `);
    return db;
  }

  it('starts each material with its current price in the history, no stock, and no wastage on existing costings', () => {
    const db = bookAtVersion11();
    migrate(db);
    expect({ ...db.prepare("SELECT unit_cost_paise, source FROM material_prices WHERE material_id = 'm1'").get() }).toEqual({ unit_cost_paise: 460000, source: 'opening' });
    expect({ ...db.prepare("SELECT stock_qty, reorder_qty, category, supplier_id FROM raw_materials WHERE id = 'm1'").get() }).toEqual({ stock_qty: 0, reorder_qty: 0, category: '', supplier_id: null });
    expect({ ...db.prepare("SELECT qty, wastage_percent FROM variant_materials WHERE variant_id = 'v1'").get() }).toEqual({ qty: 0.62, wastage_percent: 0 });
  });

  it('gives the book a shop to sell from, with every existing piece in it', () => {
    const db = bookAtVersion11();
    migrate(db);
    expect({ ...db.prepare('SELECT id, name, is_default FROM locations').get() }).toEqual({ id: 'shop', name: 'Shop', is_default: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_locations').get()).toEqual({ n: 0 }); // nothing is recorded elsewhere
    expect({ ...db.prepare("SELECT stock FROM variants WHERE id = 'v1'").get() }).toEqual({ stock: 7 });
  });
});
