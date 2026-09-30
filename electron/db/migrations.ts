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

// Several GST rates. A design can carry its own rate; a shop can also charge by price slab (e.g. 5% up to ₹2,500, 18% above).
//  • Every line of a new invoice or proforma records the rate it was taxed at, and the document records its tax by rate.
//  • Documents from before this have NULL in both places and read as one rate, the document's own, exactly as they always did.
const V7 = `
ALTER TABLE designs ADD COLUMN gst_rate_percent REAL;
ALTER TABLE invoice_lines ADD COLUMN gst_rate_percent REAL;
ALTER TABLE proforma_lines ADD COLUMN gst_rate_percent REAL;
ALTER TABLE invoices ADD COLUMN tax_summary_json TEXT;
ALTER TABLE proformas ADD COLUMN tax_summary_json TEXT;

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('gst_slabs_enabled', '0', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
`;

// Suppliers and purchase bills.
//  • A bill freezes the supplier's details and its own tax, like an invoice does, and is cancelled rather than deleted.
//  • Payments to suppliers mirror payments from customers: a payment is split across bills, and what is not on a bill is an advance
//    paid to that supplier. Nothing is stored for "outstanding" or "advance": both are worked out from the records.
//  • Lines are of three kinds: a raw material (updates its cost if asked), a finished saree (comes into stock through the ledger),
//    or anything else (freight, packing).
const V8 = `
CREATE TABLE suppliers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  gstin      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  city       TEXT NOT NULL DEFAULT '',
  state      TEXT NOT NULL DEFAULT '',
  pincode    TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX ix_suppliers_name ON suppliers (name COLLATE NOCASE);

CREATE TABLE purchase_bills (
  id               TEXT PRIMARY KEY,
  supplier_id      TEXT NOT NULL REFERENCES suppliers (id),
  bill_number      TEXT NOT NULL,
  bill_date        TEXT NOT NULL,
  due_date         TEXT,
  supplier_json    TEXT NOT NULL,
  place_of_supply  TEXT NOT NULL,
  intra_state      INTEGER NOT NULL CHECK (intra_state IN (0,1)),
  itc_eligible     INTEGER NOT NULL DEFAULT 1 CHECK (itc_eligible IN (0,1)),
  tax_summary_json TEXT NOT NULL,
  subtotal_paise   INTEGER NOT NULL,
  taxable_paise    INTEGER NOT NULL,
  cgst_paise       INTEGER NOT NULL DEFAULT 0,
  sgst_paise       INTEGER NOT NULL DEFAULT 0,
  igst_paise       INTEGER NOT NULL DEFAULT 0,
  round_off_paise  INTEGER NOT NULL DEFAULT 0,
  total_paise      INTEGER NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cancelled')),
  cancelled_at     TEXT,
  cancel_reason    TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
-- The same supplier bill number can't be entered twice while it is live (a cancelled one can be entered again, corrected).
CREATE UNIQUE INDEX ux_purchase_bills_number ON purchase_bills (supplier_id, bill_number COLLATE NOCASE) WHERE status = 'open';
CREATE INDEX ix_purchase_bills_supplier ON purchase_bills (supplier_id);
CREATE INDEX ix_purchase_bills_date ON purchase_bills (bill_date);

CREATE TABLE purchase_bill_lines (
  id               TEXT PRIMARY KEY,
  bill_id          TEXT NOT NULL REFERENCES purchase_bills (id),
  position         INTEGER NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('material','variant','other')),
  material_id      TEXT REFERENCES raw_materials (id),
  variant_id       TEXT REFERENCES variants (id),
  description      TEXT NOT NULL DEFAULT '',
  hsn              TEXT NOT NULL DEFAULT '',
  qty              REAL NOT NULL CHECK (qty > 0),
  unit             TEXT NOT NULL DEFAULT '',
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  amount_paise     INTEGER NOT NULL,
  gst_rate_percent REAL NOT NULL
);
CREATE INDEX ix_purchase_bill_lines_bill ON purchase_bill_lines (bill_id);

CREATE TABLE supplier_payments (
  id           TEXT PRIMARY KEY,
  supplier_id  TEXT NOT NULL REFERENCES suppliers (id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash','upi','bank','cheque','card','other')),
  reference    TEXT NOT NULL DEFAULT '',
  paid_on      TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  voided_at    TEXT,
  void_reason  TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_supplier_payments_supplier ON supplier_payments (supplier_id);
CREATE INDEX ix_supplier_payments_date ON supplier_payments (paid_on);

CREATE TABLE supplier_payment_allocations (
  id           TEXT PRIMARY KEY,
  payment_id   TEXT NOT NULL REFERENCES supplier_payments (id),
  bill_id      TEXT NOT NULL REFERENCES purchase_bills (id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  released_at  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_supplier_alloc_payment ON supplier_payment_allocations (payment_id);
CREATE INDEX ix_supplier_alloc_bill ON supplier_payment_allocations (bill_id);
`;

// Weavers and job work.
//  • A job order asks one weaver for some pieces of one variant at a wage per piece. Raw material handed over is recorded against it
//    (a negative quantity is material handed back), and pieces come back in receipts, each of which brings stock in through the ledger.
//  • What you owe a weaver is worked out, never stored: wages earned on receipts that have not been reversed, less what you paid.
//    A payment made before any pieces arrive is simply an advance (the balance goes negative).
const V9 = `
CREATE TABLE weavers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  place      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX ix_weavers_name ON weavers (name COLLATE NOCASE);

CREATE TABLE job_orders (
  id         TEXT PRIMARY KEY,
  number     TEXT NOT NULL,
  fy         TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  weaver_id  TEXT NOT NULL REFERENCES weavers (id),
  variant_id TEXT NOT NULL REFERENCES variants (id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  wage_paise INTEGER NOT NULL CHECK (wage_paise >= 0),
  ordered_on TEXT NOT NULL,
  expected_on TEXT,
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  closed_at  TEXT,
  close_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_job_orders_number ON job_orders (number);
CREATE UNIQUE INDEX ux_job_orders_fy_seq ON job_orders (fy, seq);
CREATE INDEX ix_job_orders_weaver ON job_orders (weaver_id);

CREATE TABLE job_order_materials (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES job_orders (id),
  material_id     TEXT NOT NULL REFERENCES raw_materials (id),
  qty             REAL NOT NULL CHECK (qty <> 0),
  unit_cost_paise INTEGER NOT NULL,
  issued_on       TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
);
CREATE INDEX ix_job_materials_order ON job_order_materials (order_id);

CREATE TABLE job_order_receipts (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES job_orders (id),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  received_on     TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  reversed_at     TEXT,
  reverse_reason  TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
);
CREATE INDEX ix_job_receipts_order ON job_order_receipts (order_id);

CREATE TABLE weaver_payments (
  id           TEXT PRIMARY KEY,
  weaver_id    TEXT NOT NULL REFERENCES weavers (id),
  order_id     TEXT REFERENCES job_orders (id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash','upi','bank','cheque','card','other')),
  reference    TEXT NOT NULL DEFAULT '',
  paid_on      TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  voided_at    TEXT,
  void_reason  TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_weaver_payments_weaver ON weaver_payments (weaver_id);
`;

// The activity log: who did what, when. Append only and tamper evident.
//  • Triggers refuse any update or delete, so the app itself cannot rewrite history.
//  • Each entry carries the hash of the one before it (prev_hash) and its own hash over its content, so an edit made behind the app's
//    back (a database editor, say) breaks the chain and the integrity check says where.
//  • A backup restore leaves this table alone: the log keeps saying what happened, including the restore itself.
const V10 = `
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  summary     TEXT NOT NULL,
  detail_json TEXT,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL
);
CREATE INDEX ix_audit_at ON audit_log (at);
CREATE INDEX ix_audit_entity ON audit_log (entity, entity_id);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'The activity log cannot be changed.'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'The activity log cannot be changed.'); END;
`;

// People who can sign in, when the owner turns on access control (it is off until then, and the app behaves as it always has).
//  • A PIN is never stored: only a salted scrypt hash of it.
//  • People are deactivated, not deleted, so the activity log can still say who did what.
const V11 = `
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  pin_salt   TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_users_name ON users (name COLLATE NOCASE) WHERE active = 1;

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('access_enabled', '0', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('auto_lock_minutes', '10', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
`;

// Append new migrations to the end; never edit one that has shipped.
const V12 = `
-- Photos of a design, stored in the database so they travel with every backup. The image is what the catalogue prints; the thumb is what
-- the lists show. Both are made small by the app before they are saved.
CREATE TABLE design_photos (
  id         TEXT PRIMARY KEY,
  design_id  TEXT NOT NULL REFERENCES designs (id),
  position   INTEGER NOT NULL,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  image      BLOB NOT NULL,
  thumb      BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_design_photos_design ON design_photos (design_id, position);
`;

const V13 = `
-- Offers: a named discount with rules (a percentage or a flat amount, a minimum bill, one design or the whole bill, a date range).
CREATE TABLE offers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('percent','flat')),
  value          REAL NOT NULL CHECK (value > 0),
  min_bill_paise INTEGER NOT NULL DEFAULT 0 CHECK (min_bill_paise >= 0),
  design_id      TEXT REFERENCES designs (id),
  start_date     TEXT NOT NULL,
  end_date       TEXT,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

-- Loyalty points: a ledger, one row per change. A customer's balance is the sum of their rows, never a stored figure.
CREATE TABLE loyalty_entries (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT NOT NULL REFERENCES customers (id),
  invoice_id     TEXT REFERENCES invoices (id),
  credit_note_id TEXT REFERENCES credit_notes (id),
  kind           TEXT NOT NULL CHECK (kind IN ('earn','redeem','reverse-earn','reverse-redeem','return','reverse-return','adjust')),
  points         INTEGER NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_loyalty_customer ON loyalty_entries (customer_id);
CREATE INDEX ix_loyalty_invoice ON loyalty_entries (invoice_id);

-- What an invoice used: the offer (frozen by name) and its share of the discount, and points spent. The invoice's discount_paise stays the
-- whole discount (manual, offer and points together), so every total and tax figure works exactly as before.
ALTER TABLE invoices ADD COLUMN offer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN offer_discount_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN points_redeemed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN points_redeemed_paise INTEGER NOT NULL DEFAULT 0;
`;

const V14 = `
-- Chasing money. A contact is one reminder, call or visit; a promise is "I will pay 5,000 on the 10th". Whether a promise was kept is worked
-- out from the payments received since (see shared/followup.ts), so only the facts are stored here.
CREATE TABLE customer_contacts (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers (id),
  channel     TEXT NOT NULL CHECK (channel IN ('whatsapp','call','visit','other')),
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX ix_contacts_customer ON customer_contacts (customer_id, created_at);

CREATE TABLE payment_promises (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers (id),
  promised_on  TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  note         TEXT NOT NULL DEFAULT '',
  cancelled_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_promises_customer ON payment_promises (customer_id, created_at);
`;

const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 1, sql: V1 },
  { version: 2, sql: V2 },
  { version: 3, sql: V3 },
  { version: 4, sql: V4 },
  { version: 5, sql: V5 },
  { version: 6, sql: V6 },
  { version: 7, sql: V7 },
  { version: 8, sql: V8 },
  { version: 9, sql: V9 },
  { version: 10, sql: V10 },
  { version: 11, sql: V11 },
  { version: 12, sql: V12 },
  { version: 13, sql: V13 },
  { version: 14, sql: V14 },
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
