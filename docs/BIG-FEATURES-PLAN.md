# Big features: plan

Each phase is built on its own: one commit (or a few), its own migration where needed, its own tests, and the README updated. Phases go in this order because later ones lean on earlier ones. Backup comes first so that every risky change after it has a safety net, and so photos (phase 4) are covered by it.

## 1. Backup, restore and Google Drive (no migration)
- Backup lives in `electron/backup.ts`; Google Drive in `electron/drive.ts`. Neither touches the renderer except through the typed API.
- Local: daily automatic copy (kept 14), "Back up now", a second folder of your choice (a pen drive, another disk), "Save a copy to..." anywhere.
- Online: sign in to Google from Settings; backups go to a folder the app creates in your Drive called "InvoiceOn backups". The app can only see files it made itself (the `drive.file` permission), never the rest of your Drive.
- Restore from the list, from a file, or from Drive. A restore is staged and applied on the next start, before the book is opened, after a "before restore" safety copy of the current book. Backups from a newer version of the app are refused. Backup settings and Google sign-in are kept outside the book so a restore never changes them.
- Google credentials: the app needs a Google Cloud "Desktop app" client ID and secret, which only you can create. Steps are in Settings > Backup.

## 2. Money maths together (migration 14)
Round-off policy, per-line discounts and line notes, multi-rate GST (rate per line, from the HSN or typed). These all change how a total is worked out, so they are designed once in `shared/gst.ts` and tested together. Issued invoices keep their old maths.

## 3. Credit notes, returns and refunds (migration 15)
A credit note is a new immutable document pointing at the invoice. It reverses tax, can put stock back through the ledger, and ends as a refund or a credit on the customer's account.

## 4. Photos and attachments (migration 16)
Photos of designs and colours, a picture grid, receipt photos on expenses. Stored inside the book (compressed in the app to about 100 KB each) rather than loose files, so one backup file always holds everything and a restore can never leave pictures behind.

## 5. Counter tools (migration 17)
Barcodes and QR labels per colour and size, scan to add, a quick-bill screen for the counter.

## 6. Stock and production (migration 18)
Reserving stock for a quote until it lapses, production orders, job-work tracking.

## 7. Customers (migration 19)
Loyalty points and wishlists.

## 8. The shell
Dark mode, invoice layouts (compact, A5, thermal), printer settings, languages and formats, users with roles and a PIN (the activity log then says who), a second window.

## 9. Smaller leftovers
Bulk PDF / ZIP of invoices, statement and receipt PDFs where missing, spreadsheet import wizard, GSTR-1 and 3B JSON, message templates.

## Cannot be built from inside the app
E-invoice (IRN) and e-way bill need an approved GST provider and your credentials. GSTIN look-up needs a paid look-up service. Accept and decline links and emailed scheduled reports need a server that is always on. The WhatsApp link can only pre-fill text; it cannot attach a file. Auto-update needs releases published somewhere (GitHub Releases would do).
