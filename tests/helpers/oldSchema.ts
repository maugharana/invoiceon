/**
 * SQL that puts a freshly migrated database back into exactly the shape stage 2 left it in (invoicing, but no payments,
 * proformas, expenses, MRP or anything added since), so tests can prove an old file upgrades in place and restores cleanly.
 *
 * Every schema migration after stage 2 must add its undo here: drop the tables it created and the columns it added.
 * Data written before the rewind stays, which is the point: it plays the part of records made by the old version.
 */
export const REWIND_TO_STAGE_2 = `
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
