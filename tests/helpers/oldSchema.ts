/**
 * SQL that puts a freshly migrated database back into exactly the shape stage 2 left it in (invoicing, but no payments,
 * proformas, expenses, MRP or anything added since), so tests can prove an old file upgrades in place and restores cleanly.
 *
 * Every schema migration after stage 2 must add its undo here: drop the tables it created and the columns it added.
 * Data written before the rewind stays, which is the point: it plays the part of records made by the old version.
 */
export const REWIND_TO_STAGE_2 = `
  DROP TABLE payment_promises;
  DROP TABLE customer_contacts;
  DROP TABLE loyalty_entries;
  DROP TABLE offers;
  ALTER TABLE invoices DROP COLUMN points_redeemed_paise;
  ALTER TABLE invoices DROP COLUMN points_redeemed;
  ALTER TABLE invoices DROP COLUMN offer_discount_paise;
  ALTER TABLE invoices DROP COLUMN offer_name;
  DROP TABLE design_photos;
  DROP TABLE users;
  DROP TABLE audit_log;
  DROP TABLE weaver_payments;
  DROP TABLE job_order_receipts;
  DROP TABLE job_order_materials;
  DROP TABLE job_orders;
  DROP TABLE weavers;
  DROP TABLE supplier_payment_allocations;
  DROP TABLE supplier_payments;
  DROP TABLE purchase_bill_lines;
  DROP TABLE purchase_bills;
  DROP TABLE suppliers;
  ALTER TABLE invoices DROP COLUMN tax_summary_json;
  ALTER TABLE invoice_lines DROP COLUMN gst_rate_percent;
  ALTER TABLE designs DROP COLUMN gst_rate_percent;
  DROP TABLE credit_note_lines;
  DROP TABLE credit_notes;
  ALTER TABLE variants DROP COLUMN mrp_paise;
  DROP TABLE proforma_lines;
  DROP TABLE proformas;
  DROP TABLE expenses;
  DROP TABLE payment_allocations;
  DROP TABLE payments;
  PRAGMA user_version = 2;
`;
