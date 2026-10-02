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

// Stage 8: a one-word short name for each design ("Kadhua" for Banarasi Katan Kadhua), used to find and call out a saree quickly.
const V6 = `
ALTER TABLE designs ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
`;

// Stage 9: whether the prices on a document already included GST, frozen at issue so old invoices redraw the way they were made.
const V7 = `
ALTER TABLE invoices ADD COLUMN prices_include_gst INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proformas ADD COLUMN prices_include_gst INTEGER NOT NULL DEFAULT 0;
`;

// Stage 10: who customers are beyond a name (tags, credit limit, terms, birthdays, extra addresses and contacts), tags on designs, a
// notes timeline for calls and follow-ups (shared by customers, quotes and invoices), and a history of each variant's prices.
const V8 = `
ALTER TABLE designs ADD COLUMN tags TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN tags TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN credit_limit_paise INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0);
ALTER TABLE customers ADD COLUMN payment_terms_days INTEGER CHECK (payment_terms_days IS NULL OR (payment_terms_days >= 0 AND payment_terms_days <= 365));
ALTER TABLE customers ADD COLUMN birthday TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN anniversary TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN addresses_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE customers ADD COLUMN contacts_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE notes (
  id           TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('customer','proforma','invoice')),
  subject_id   TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','call','visit','followup','promise')),
  body         TEXT NOT NULL DEFAULT '',
  due_date     TEXT,
  amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  done_at      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX ix_notes_subject ON notes (subject_type, subject_id);
CREATE INDEX ix_notes_due ON notes (due_date) WHERE done_at IS NULL AND deleted_at IS NULL;

CREATE TABLE price_history (
  id               TEXT PRIMARY KEY,
  variant_id       TEXT NOT NULL REFERENCES variants (id),
  sell_price_paise INTEGER NOT NULL,
  mrp_paise        INTEGER NOT NULL DEFAULT 0,
  base_cost_paise  INTEGER NOT NULL DEFAULT 0,
  changed_at       TEXT NOT NULL
);
CREATE INDEX ix_price_history_variant ON price_history (variant_id, changed_at);
-- Every variant that already exists starts its history with the prices it has now.
INSERT INTO price_history (id, variant_id, sell_price_paise, mrp_paise, base_cost_paise, changed_at)
  SELECT lower(hex(randomblob(16))), id, sell_price_paise, mrp_paise, base_cost_paise, created_at FROM variants;
`;

// Stage 11: delivery details on an invoice (where it goes, who carries it, whether it arrived) and separate numbering series, so B2B
// invoices can run their own sequence. A number is unique within its year and series.
const V9 = `
ALTER TABLE invoices ADD COLUMN series TEXT NOT NULL DEFAULT '';
DROP INDEX ux_invoices_fy_seq;
CREATE UNIQUE INDEX ux_invoices_fy_series_seq ON invoices (fy, series, seq);
ALTER TABLE invoices ADD COLUMN ship_to_json TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN transport TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN tracking_no TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'none' CHECK (delivery_status IN ('none','pending','dispatched','delivered'));
ALTER TABLE invoices ADD COLUMN delivered_on TEXT;
`;

// Stage 12: the life of a quote. Where it stands with the customer (open, accepted, lost), how much has been invoiced line by line
// (partial conversion), older versions of it, deposits taken against it, and reusable quote templates.
const V10 = `
ALTER TABLE proformas ADD COLUMN stage TEXT NOT NULL DEFAULT 'open' CHECK (stage IN ('open','accepted','lost'));
ALTER TABLE proformas ADD COLUMN lost_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE proforma_lines ADD COLUMN invoiced_qty INTEGER NOT NULL DEFAULT 0 CHECK (invoiced_qty >= 0);

CREATE TABLE proforma_invoices (
  proforma_id TEXT NOT NULL REFERENCES proformas (id),
  invoice_id  TEXT NOT NULL REFERENCES invoices (id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (proforma_id, invoice_id)
);
INSERT INTO proforma_invoices (proforma_id, invoice_id, created_at) SELECT id, invoice_id, updated_at FROM proformas WHERE invoice_id IS NOT NULL;
UPDATE proforma_lines SET invoiced_qty = qty WHERE proforma_id IN (SELECT id FROM proformas WHERE status = 'converted');

CREATE TABLE proforma_revisions (
  id            TEXT PRIMARY KEY,
  proforma_id   TEXT NOT NULL REFERENCES proformas (id),
  version       INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (proforma_id, version)
);

CREATE TABLE quote_templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  lines_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX ux_quote_templates_name ON quote_templates (name COLLATE NOCASE) WHERE deleted_at IS NULL;

ALTER TABLE payments ADD COLUMN proforma_id TEXT REFERENCES proformas (id);
`;

// Stage 13: money in more detail. Payments know which account they went into, can be write-offs, and cheques can be post-dated
// and tracked; bank statements can be matched (reconciled_on); balances can be settled in instalments; the cash drawer can be
// counted at the end of the day; money can move between accounts. Expenses gain vendors, input GST, the account they were paid
// from, an unpaid state, and recurring templates.
const V11 = `
ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'receipt' CHECK (kind IN ('receipt','writeoff'));
ALTER TABLE payments ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN cheque_date TEXT;
ALTER TABLE payments ADD COLUMN cheque_status TEXT CHECK (cheque_status IS NULL OR cheque_status IN ('pending','deposited','cleared','bounced'));
ALTER TABLE payments ADD COLUMN reconciled_on TEXT;
CREATE INDEX ix_payments_cheque ON payments (cheque_status, cheque_date) WHERE cheque_status IS NOT NULL;

CREATE TABLE instalments (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL REFERENCES invoices (id),
  position     INTEGER NOT NULL,
  due_date     TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  created_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX ix_instalments_invoice ON instalments (invoice_id);

CREATE TABLE cash_closes (
  id             TEXT PRIMARY KEY,
  day            TEXT NOT NULL,
  expected_paise INTEGER NOT NULL,
  counted_paise  INTEGER NOT NULL CHECK (counted_paise >= 0),
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_cash_closes_day ON cash_closes (day);

CREATE TABLE account_transfers (
  id            TEXT PRIMARY KEY,
  from_account  TEXT NOT NULL,
  to_account    TEXT NOT NULL,
  amount_paise  INTEGER NOT NULL CHECK (amount_paise > 0),
  transfer_date TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);

-- The people and businesses money is paid to. Raw-material suppliers are vendors too.
CREATE TABLE vendors (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  gstin      TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX ux_vendors_name ON vendors (name COLLATE NOCASE) WHERE deleted_at IS NULL;
-- Everyone already typed into "Paid to" becomes a vendor (spelt the way it was first entered).
INSERT INTO vendors (id, name, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), MIN(vendor), MIN(created_at), MIN(created_at) FROM expenses WHERE vendor <> '' AND deleted_at IS NULL GROUP BY lower(vendor);

ALTER TABLE expenses ADD COLUMN vendor_id TEXT REFERENCES vendors (id);
UPDATE expenses SET vendor_id = (SELECT v.id FROM vendors v WHERE v.name = expenses.vendor COLLATE NOCASE AND v.deleted_at IS NULL) WHERE vendor <> '';
ALTER TABLE expenses ADD COLUMN gst_paise INTEGER NOT NULL DEFAULT 0 CHECK (gst_paise >= 0);
ALTER TABLE expenses ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','unpaid'));
ALTER TABLE expenses ADD COLUMN due_date TEXT;
ALTER TABLE expenses ADD COLUMN paid_on TEXT;
UPDATE expenses SET paid_on = expense_date;
ALTER TABLE expenses ADD COLUMN recurring_id TEXT;

CREATE TABLE recurring_expenses (
  id           TEXT PRIMARY KEY,
  category     TEXT NOT NULL,
  vendor       TEXT NOT NULL DEFAULT '',
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  gst_paise    INTEGER NOT NULL DEFAULT 0 CHECK (gst_paise >= 0),
  method       TEXT NOT NULL CHECK (method IN ('cash','upi','bank','cheque','card','other')),
  account_id   TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  frequency    TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  next_date    TEXT NOT NULL,
  end_date     TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
`;

// Stage 14: raw materials as stock you can run short of (quantities, a ledger, categories, a usual supplier, price history),
// buying them (purchases), wastage in the costing, designs with a usual supplier, and more than one place to keep sarees.
const V12 = `
ALTER TABLE raw_materials ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE raw_materials ADD COLUMN stock_qty REAL NOT NULL DEFAULT 0 CHECK (stock_qty >= 0);
ALTER TABLE raw_materials ADD COLUMN reorder_qty REAL NOT NULL DEFAULT 0 CHECK (reorder_qty >= 0);
ALTER TABLE raw_materials ADD COLUMN supplier_id TEXT REFERENCES vendors (id);
-- Extra material that is lost in making a piece (cut ends, spoilage), as a share of the quantity in the costing.
ALTER TABLE variant_materials ADD COLUMN wastage_percent REAL NOT NULL DEFAULT 0 CHECK (wastage_percent >= 0 AND wastage_percent <= 100);
ALTER TABLE designs ADD COLUMN supplier_id TEXT REFERENCES vendors (id);

-- What a material has cost over time. Every material starts its history with the price it has now.
CREATE TABLE material_prices (
  id              TEXT PRIMARY KEY,
  material_id     TEXT NOT NULL REFERENCES raw_materials (id),
  unit_cost_paise INTEGER NOT NULL CHECK (unit_cost_paise >= 0),
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('opening','manual','purchase')),
  changed_at      TEXT NOT NULL
);
CREATE INDEX ix_material_prices_material ON material_prices (material_id, changed_at);
INSERT INTO material_prices (id, material_id, unit_cost_paise, source, changed_at)
  SELECT lower(hex(randomblob(16))), id, unit_cost_paise, 'opening', created_at FROM raw_materials;

-- A ledger for raw-material stock, like the one for sarees: stock_qty is the balance, this says why it moved.
CREATE TABLE material_movements (
  id            TEXT PRIMARY KEY,
  material_id   TEXT NOT NULL REFERENCES raw_materials (id),
  delta         REAL NOT NULL CHECK (delta <> 0),
  balance_after REAL NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('opening','purchase','used','wastage','adjustment')),
  note          TEXT NOT NULL DEFAULT '',
  ref_type      TEXT,
  ref_id        TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX ix_material_movements_material ON material_movements (material_id, created_at);

-- Buying raw material: what came in from whom, at what price. It can also be entered as an expense (expense_id).
CREATE TABLE purchases (
  id            TEXT PRIMARY KEY,
  supplier_id   TEXT REFERENCES vendors (id),
  purchase_date TEXT NOT NULL,
  bill_no       TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  total_paise   INTEGER NOT NULL CHECK (total_paise >= 0),
  gst_paise     INTEGER NOT NULL DEFAULT 0 CHECK (gst_paise >= 0),
  expense_id    TEXT REFERENCES expenses (id),
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX ix_purchases_date ON purchases (purchase_date);
CREATE TABLE purchase_lines (
  id              TEXT PRIMARY KEY,
  purchase_id     TEXT NOT NULL REFERENCES purchases (id),
  material_id     TEXT NOT NULL REFERENCES raw_materials (id),
  position        INTEGER NOT NULL,
  qty             REAL NOT NULL CHECK (qty > 0),
  unit_cost_paise INTEGER NOT NULL CHECK (unit_cost_paise >= 0),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise >= 0)
);
CREATE INDEX ix_purchase_lines_purchase ON purchase_lines (purchase_id);

-- Where finished sarees are kept. "Shop" is where they are sold from; other places (a godown) hold stock until it is moved.
-- variants.stock stays the total; stock_locations holds only what is kept somewhere other than the shop.
CREATE TABLE locations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX ux_locations_name ON locations (name COLLATE NOCASE) WHERE deleted_at IS NULL;
INSERT INTO locations (id, name, is_default, created_at) VALUES ('shop', 'Shop', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
CREATE TABLE stock_locations (
  variant_id  TEXT NOT NULL REFERENCES variants (id),
  location_id TEXT NOT NULL REFERENCES locations (id),
  qty         INTEGER NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (variant_id, location_id)
);
CREATE TABLE stock_transfers (
  id               TEXT PRIMARY KEY,
  variant_id       TEXT NOT NULL REFERENCES variants (id),
  from_location_id TEXT NOT NULL REFERENCES locations (id),
  to_location_id   TEXT NOT NULL REFERENCES locations (id),
  qty              INTEGER NOT NULL CHECK (qty > 0),
  note             TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL
);
CREATE INDEX ix_stock_transfers_variant ON stock_transfers (variant_id, created_at);
`;

// Stage 15: a record of what was done (the activity log), and bills held half-made to resume later.
const V13 = `
-- A plain record of what was done and when, for looking back at "who changed this?". It is written beside each change and never
-- edited. It carries a short description, not the data itself, so it does not grow into a second copy of the book.
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  action      TEXT NOT NULL,
  label       TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   TEXT NOT NULL DEFAULT '',
  summary     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ix_audit_log_at ON audit_log (at);
CREATE INDEX ix_audit_log_entity ON audit_log (entity_type, entity_id);

-- Bills set aside half-made so the counter is free for the next customer, to be picked up again later.
CREATE TABLE held_bills (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice','proforma')),
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  deleted_at   TEXT
);
`;

// 14: a discount, a GST rate and a note on each line; the tax kept per line. Invoices made before this keep their one rate:
// their lines get that rate, and no per-line tax (the reports then share the invoice's tax over the lines as they always did).
const V14 = `
ALTER TABLE invoice_lines ADD COLUMN gst_rate_percent REAL;
ALTER TABLE invoice_lines ADD COLUMN line_discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (line_discount_paise >= 0);
ALTER TABLE invoice_lines ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE invoice_lines ADD COLUMN taxable_paise INTEGER;
ALTER TABLE invoice_lines ADD COLUMN tax_paise INTEGER;
UPDATE invoice_lines SET gst_rate_percent = (SELECT i.gst_rate_percent FROM invoices i WHERE i.id = invoice_lines.invoice_id);

ALTER TABLE proforma_lines ADD COLUMN gst_rate_percent REAL;
ALTER TABLE proforma_lines ADD COLUMN line_discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (line_discount_paise >= 0);
ALTER TABLE proforma_lines ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE proforma_lines ADD COLUMN taxable_paise INTEGER;
ALTER TABLE proforma_lines ADD COLUMN tax_paise INTEGER;
UPDATE proforma_lines SET gst_rate_percent = (SELECT p.gst_rate_percent FROM proformas p WHERE p.id = proforma_lines.proforma_id);

ALTER TABLE invoices ADD COLUMN line_discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (line_discount_paise >= 0);
ALTER TABLE proformas ADD COLUMN line_discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (line_discount_paise >= 0);

-- A design taxed at its own rate (null = the shop's usual rate or a price slab).
ALTER TABLE designs ADD COLUMN gst_rate_percent REAL;
`;

// Append new migrations to the end; never edit one that has shipped.
const V15 = `
-- What a saree is made of and how, as separate fields, so its full name can be built the same way every time (shared/nomenclature.ts).
ALTER TABLE designs ADD COLUMN weave_style TEXT NOT NULL DEFAULT '';
ALTER TABLE designs ADD COLUMN technique TEXT NOT NULL DEFAULT '';
ALTER TABLE designs ADD COLUMN work TEXT NOT NULL DEFAULT '';

-- Choices the shop added itself (a new technique, a new colour), kept so they appear in the pick lists next time.
CREATE TABLE catalogue_options (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  label      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_catalogue_options ON catalogue_options (kind, label COLLATE NOCASE);
`;

const V16 = `
-- The pattern woven all over a saree (Butidar, Jaal…): one choice, kept apart from the special work done on it.
ALTER TABLE designs ADD COLUMN pattern TEXT NOT NULL DEFAULT '';
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
  { version: 15, sql: V15 },
  { version: 16, sql: V16 },
];

/** Brings a database up to date. `upTo` stops early at a version, which only the tests use, to build an older database to upgrade. */
export function migrate(db: DatabaseSync, upTo: number = Number.POSITIVE_INFINITY): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (const m of MIGRATIONS) {
    if (m.version <= row.user_version || m.version > upTo) continue;
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
