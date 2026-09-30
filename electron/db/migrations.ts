import type { DatabaseSync } from 'node:sqlite';

// Design notes that later stages (and sync) depend on:
//  • Primary keys are TEXT UUIDs generated in the app, so rows created on different devices never collide.
//  • Every row carries created_at / updated_at (ISO-8601 UTC) and soft-deletes via deleted_at, which is what
//    a future sync engine needs to reconcile changes and propagate deletions.
//  • Money is INTEGER paise. Stock is INTEGER pieces. Only raw-material quantities are REAL (metres, kg).
//  • Stock is a ledger: variants.stock is a cached balance, stock_movements is the source of truth for why.

const V1 = `
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- SKU = a saree design. Colour and size live on its variants.
CREATE TABLE designs (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL,
  name                TEXT NOT NULL,
  fabric              TEXT NOT NULL DEFAULT '',
  hsn_code            TEXT NOT NULL DEFAULT '',
  description         TEXT NOT NULL DEFAULT '',
  default_price_paise INTEGER NOT NULL DEFAULT 0 CHECK (default_price_paise >= 0),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT
);
CREATE UNIQUE INDEX ux_designs_code ON designs (code COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE raw_materials (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  unit            TEXT NOT NULL,
  unit_cost_paise INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_paise >= 0),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE UNIQUE INDEX ux_materials_name ON raw_materials (name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE variants (
  id               TEXT PRIMARY KEY,
  design_id        TEXT NOT NULL REFERENCES designs (id),
  sku              TEXT NOT NULL,
  color            TEXT NOT NULL,
  size             TEXT NOT NULL,
  stock            INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  reorder_level    INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  base_cost_paise  INTEGER NOT NULL DEFAULT 0 CHECK (base_cost_paise >= 0),
  sell_price_paise INTEGER NOT NULL DEFAULT 0 CHECK (sell_price_paise >= 0),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);
CREATE UNIQUE INDEX ux_variants_sku ON variants (sku COLLATE NOCASE) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_variants_combo ON variants (design_id, color COLLATE NOCASE, size COLLATE NOCASE) WHERE deleted_at IS NULL;
CREATE INDEX ix_variants_design ON variants (design_id);

-- Bill of materials: what raw materials go into one piece of this variant.
CREATE TABLE variant_materials (
  variant_id  TEXT NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES raw_materials (id),
  qty         REAL NOT NULL CHECK (qty > 0),
  PRIMARY KEY (variant_id, material_id)
);

CREATE TABLE stock_movements (
  id              TEXT PRIMARY KEY,
  variant_id      TEXT NOT NULL REFERENCES variants (id),
  delta           INTEGER NOT NULL CHECK (delta <> 0),
  balance_after   INTEGER NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('opening','purchase','production','sale','return','adjustment','damage')),
  note            TEXT NOT NULL DEFAULT '',
  unit_cost_paise INTEGER NOT NULL DEFAULT 0,
  ref_type        TEXT,
  ref_id          TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX ix_movements_variant ON stock_movements (variant_id, created_at);

INSERT INTO settings (key, value, updated_at) VALUES
  ('business_name', 'Mau Gharana', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('gst_rate_percent', '5', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('default_reorder_level', '2', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
`;

// Stage 2: customers and invoicing.
//  • An issued invoice is immutable. It carries frozen copies of the seller and buyer details (so editing a
//    customer later never rewrites history) and of each line's description, HSN and price.
//  • Changes happen by cancelling and re-issuing; a cancelled invoice keeps its number.
//  • invoice_lines.unit_cost_paise snapshots cost at time of sale, for profit reporting later.
const V2 = `
CREATE TABLE customers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'B2C' CHECK (type IN ('B2B','B2C')),
  phone      TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  gstin      TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  city       TEXT NOT NULL DEFAULT '',
  state      TEXT NOT NULL DEFAULT '',
  pincode    TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX ix_customers_name ON customers (name COLLATE NOCASE);

CREATE TABLE invoices (
  id               TEXT PRIMARY KEY,
  number           TEXT NOT NULL,
  fy               TEXT NOT NULL,
  seq              INTEGER NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('B2B','B2C')),
  customer_id      TEXT REFERENCES customers (id),
  seller_json      TEXT NOT NULL,
  buyer_json       TEXT NOT NULL,
  place_of_supply  TEXT NOT NULL,
  issue_date       TEXT NOT NULL,
  due_date         TEXT,
  gst_rate_percent REAL NOT NULL,
  intra_state      INTEGER NOT NULL CHECK (intra_state IN (0,1)),
  subtotal_paise   INTEGER NOT NULL,
  discount_paise   INTEGER NOT NULL DEFAULT 0,
  taxable_paise    INTEGER NOT NULL,
  cgst_paise       INTEGER NOT NULL DEFAULT 0,
  sgst_paise       INTEGER NOT NULL DEFAULT 0,
  igst_paise       INTEGER NOT NULL DEFAULT 0,
  round_off_paise  INTEGER NOT NULL DEFAULT 0,
  total_paise      INTEGER NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','cancelled')),
  cancelled_at     TEXT,
  cancel_reason    TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_invoices_number ON invoices (number);
CREATE UNIQUE INDEX ux_invoices_fy_seq ON invoices (fy, seq);
CREATE INDEX ix_invoices_customer ON invoices (customer_id);
CREATE INDEX ix_invoices_date ON invoices (issue_date);

CREATE TABLE invoice_lines (
  id               TEXT PRIMARY KEY,
  invoice_id       TEXT NOT NULL REFERENCES invoices (id),
  variant_id       TEXT NOT NULL REFERENCES variants (id),
  position         INTEGER NOT NULL,
  design_name      TEXT NOT NULL,
  color            TEXT NOT NULL,
  size             TEXT NOT NULL,
  sku              TEXT NOT NULL,
  hsn              TEXT NOT NULL DEFAULT '',
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  amount_paise     INTEGER NOT NULL,
  unit_cost_paise  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_invoice_lines_invoice ON invoice_lines (invoice_id);
CREATE INDEX ix_invoice_lines_variant ON invoice_lines (variant_id);

INSERT INTO settings (key, value, updated_at) VALUES
  ('gstin', '', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('address_line', '', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('city', 'Mau', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('state', 'Uttar Pradesh', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('pincode', '', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('phone', '', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('email', '', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('invoice_prefix', 'MG', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('default_due_days', '15', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('invoice_terms', 'Goods once sold will not be taken back or exchanged. Subject to Mau jurisdiction.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
`;

// Stage 3: payments and the customer ledger.
//  • A payment belongs to a customer (or, for a walk-in sale, only to that invoice) and is split across invoices by
//    payment_allocations. Whatever isn't allocated is the customer's *advance* — there's no separate advance table.
//  • Nothing is ever deleted: a wrong payment is voided, and cancelling an invoice *releases* its allocations
//    (released_at), so the audit trail stays and the money returns to the customer's advance.
const V3 = `
CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT REFERENCES customers (id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash','upi','bank','cheque','card','other')),
  reference    TEXT NOT NULL DEFAULT '',
  received_on  TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  voided_at    TEXT,
  void_reason  TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_payments_customer ON payments (customer_id);
CREATE INDEX ix_payments_date ON payments (received_on);

CREATE TABLE payment_allocations (
  id           TEXT PRIMARY KEY,
  payment_id   TEXT NOT NULL REFERENCES payments (id),
  invoice_id   TEXT NOT NULL REFERENCES invoices (id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  released_at  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_alloc_payment ON payment_allocations (payment_id);
CREATE INDEX ix_alloc_invoice ON payment_allocations (invoice_id);
`;

// Stage 6: expenses and proforma invoices.
//  • An expense is money the business spent (soft-deleted, so history is never silently lost).
//  • A proforma is a quote. It reserves no stock and is not a tax document. It freezes seller/buyer/prices like an invoice does,
//    and 'converted' points at the invoice it became.
const V4 = `
CREATE TABLE expenses (
  id           TEXT PRIMARY KEY,
  expense_date TEXT NOT NULL,
  category     TEXT NOT NULL,
  vendor       TEXT NOT NULL DEFAULT '',
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash','upi','bank','cheque','card','other')),
  reference    TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX ix_expenses_date ON expenses (expense_date);

CREATE TABLE proformas (
  id               TEXT PRIMARY KEY,
  number           TEXT NOT NULL,
  fy               TEXT NOT NULL,
  seq              INTEGER NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('B2B','B2C')),
  customer_id      TEXT REFERENCES customers (id),
  seller_json      TEXT NOT NULL,
  buyer_json       TEXT NOT NULL,
  place_of_supply  TEXT NOT NULL,
  issue_date       TEXT NOT NULL,
  valid_until      TEXT NOT NULL,
  gst_rate_percent REAL NOT NULL,
  intra_state      INTEGER NOT NULL CHECK (intra_state IN (0,1)),
  subtotal_paise   INTEGER NOT NULL,
  discount_paise   INTEGER NOT NULL DEFAULT 0,
  taxable_paise    INTEGER NOT NULL,
  cgst_paise       INTEGER NOT NULL DEFAULT 0,
  sgst_paise       INTEGER NOT NULL DEFAULT 0,
  igst_paise       INTEGER NOT NULL DEFAULT 0,
  round_off_paise  INTEGER NOT NULL DEFAULT 0,
  total_paise      INTEGER NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted','cancelled')),
  invoice_id       TEXT REFERENCES invoices (id),
  cancelled_at     TEXT,
  cancel_reason    TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_proformas_number ON proformas (number);
CREATE UNIQUE INDEX ux_proformas_fy_seq ON proformas (fy, seq);
CREATE INDEX ix_proformas_customer ON proformas (customer_id);

CREATE TABLE proforma_lines (
  id               TEXT PRIMARY KEY,
  proforma_id      TEXT NOT NULL REFERENCES proformas (id),
  variant_id       TEXT NOT NULL REFERENCES variants (id),
  position         INTEGER NOT NULL,
  design_name      TEXT NOT NULL,
  color            TEXT NOT NULL,
  size             TEXT NOT NULL,
  sku              TEXT NOT NULL,
  hsn              TEXT NOT NULL DEFAULT '',
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  amount_paise     INTEGER NOT NULL
);
CREATE INDEX ix_proforma_lines_proforma ON proforma_lines (proforma_id);
`;

// Stage 7: MRP (the printed maximum retail price, GST included) on each variant. Zero means "not set".
const V5 = `
ALTER TABLE variants ADD COLUMN mrp_paise INTEGER NOT NULL DEFAULT 0;
`;


// Credit notes (sales returns and price adjustments).
//  • A credit note is immutable, like an invoice: it freezes seller, buyer, prices and tax. It points at the invoice it corrects.
//  • Returned pieces go back through the stock ledger (reason 'return'), unless the owner says they are not resaleable.
//  • The money side reuses the payments machinery: the part of a credit note that is not refunded becomes a payment with
//    source 'credit_note', allocated to the invoice up to what is still owed and held as the customer's advance beyond that.
//    That keeps outstanding, advance, dues and the ledger consistent with no second set of sums to drift.
const V6 = `
CREATE TABLE credit_notes (
  id                TEXT PRIMARY KEY,
  number            TEXT NOT NULL,
  fy                TEXT NOT NULL,
  seq               INTEGER NOT NULL,
  invoice_id        TEXT NOT NULL REFERENCES invoices (id),
  customer_id       TEXT REFERENCES customers (id),
  kind              TEXT NOT NULL CHECK (kind IN ('return','adjustment')),
  seller_json       TEXT NOT NULL,
  buyer_json        TEXT NOT NULL,
  place_of_supply   TEXT NOT NULL,
  issue_date        TEXT NOT NULL,
  intra_state       INTEGER NOT NULL CHECK (intra_state IN (0,1)),
  gst_rate_percent  REAL NOT NULL,
  tax_summary_json  TEXT NOT NULL,
  taxable_paise     INTEGER NOT NULL,
  cgst_paise        INTEGER NOT NULL DEFAULT 0,
  sgst_paise        INTEGER NOT NULL DEFAULT 0,
  igst_paise        INTEGER NOT NULL DEFAULT 0,
  round_off_paise   INTEGER NOT NULL DEFAULT 0,
  total_paise       INTEGER NOT NULL CHECK (total_paise >= 0),
  reason            TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  refund_paise      INTEGER NOT NULL DEFAULT 0,
  refund_method     TEXT,
  refund_reference  TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','cancelled')),
  cancelled_at      TEXT,
  cancel_reason     TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_credit_notes_number ON credit_notes (number);
CREATE UNIQUE INDEX ux_credit_notes_fy_seq ON credit_notes (fy, seq);
CREATE INDEX ix_credit_notes_invoice ON credit_notes (invoice_id);
CREATE INDEX ix_credit_notes_customer ON credit_notes (customer_id);
CREATE INDEX ix_credit_notes_date ON credit_notes (issue_date);

CREATE TABLE credit_note_lines (
  id               TEXT PRIMARY KEY,
  credit_note_id   TEXT NOT NULL REFERENCES credit_notes (id),
  invoice_line_id  TEXT REFERENCES invoice_lines (id),
  variant_id       TEXT REFERENCES variants (id),
  position         INTEGER NOT NULL,
  design_name      TEXT NOT NULL,
  color            TEXT NOT NULL DEFAULT '',
  size             TEXT NOT NULL DEFAULT '',
  sku              TEXT NOT NULL DEFAULT '',
  hsn              TEXT NOT NULL DEFAULT '',
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_paise INTEGER NOT NULL,
  amount_paise     INTEGER NOT NULL,
  taxable_paise    INTEGER NOT NULL,
  gst_rate_percent REAL NOT NULL,
  restock          INTEGER NOT NULL DEFAULT 1 CHECK (restock IN (0,1)),
  unit_cost_paise  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_credit_note_lines_note ON credit_note_lines (credit_note_id);
CREATE INDEX ix_credit_note_lines_invoice_line ON credit_note_lines (invoice_line_id);

ALTER TABLE payments ADD COLUMN source TEXT NOT NULL DEFAULT 'receipt';
ALTER TABLE payments ADD COLUMN credit_note_id TEXT;

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('credit_note_prefix', 'CN', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
`;

// Append new migrations to the end; never edit one that has shipped.
const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 1, sql: V1 },
  { version: 2, sql: V2 },
  { version: 3, sql: V3 },
  { version: 4, sql: V4 },
  { version: 5, sql: V5 },
  { version: 6, sql: V6 },
];

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (const m of MIGRATIONS) {
    if (m.version <= row.user_version) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Database migration ${m.version} failed: ${(err as Error).message}`);
    }
  }
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
