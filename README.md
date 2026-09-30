# InvoiceOn — simple, always on

Invoicing and inventory for small businesses. Built first for Mau Gharana (sarees), designed to be sold on.
Windows desktop app, offline-first: your data lives in a local SQLite file, no internet needed.

## Status

| Stage | Scope | State |
|---|---|---|
| 1 | Project, database, SKU & inventory (designs, variants, stock, raw-material costing) | **Done** |
| 2 | Customers, invoicing (B2B/B2C, GST), PDF export, print, settings | **Done** |
| 3 | Payments, customer ledger, advance/balance, dues dashboard | **Done** |
| 4 | Reports (sales, GST, stock valuation) | **Done** |
| 5 | Animation & UI polish pass | **Done** |
| 6 | Dashboard, proformas, expenses, quick-create, command palette | **Done** |
| 8 | Credit notes and sales returns | **Done** |
| 9 | Restore from backup | **Done** |
| 10 | Several GST rates (per design, and by price step) | **Done** |
| 11 | Suppliers, purchase bills, payables, input tax credit | **Done** |
| 12 | Weavers and job work orders | **Done** |
| 13 | Barcode labels and scan to bill | **Done** |
| 14 | Sharing (WhatsApp, email), reminders, UPI QR | **Done** |
| 15 | Activity log and "Check my books" | **Done** |
| 16 | Users, roles and PIN lock | **Done** |
| 17 | GSTR-1, e-invoice and e-way bill files | **Done** |
| 18 | Off-site copy, optionally encrypted | **Done** |
| 19 | Read only phone view on the shop Wi-Fi | **Done** |
| 20 | Design photos and a shareable catalogue | **Done** |
| 21 | Offers and loyalty points | **Done** |
| 22 | Dues follow-up and promises to pay | **Done** |
| 23 | Restock suggestions and dead stock | **Done** |
| 24 | Stock in other places | **Done** |
| 25 | Physical stock take | **Done** |
| 26 | Invoice layouts and several businesses | **Done** (switching businesses not run in a live Electron window) |
| 27 | Customer import and getting started checklist | **Done** |

**New here? Start with [`docs/TOUR.md`](docs/TOUR.md)** — a ten-minute guided tour (see it, generate a PDF, see what the PDF looks
like, customise it). Sample PDFs are in [`sample-pdfs/`](sample-pdfs). If packaging fails on Windows, see
[`docs/WINDOWS-ISSUES.md`](docs/WINDOWS-ISSUES.md).

## Run it

```bash
npm install
npm run demo       # browser preview at http://localhost:5173 with sample data in every tab (throwaway database)
node node_modules/electron/install.js   # only if Electron's binary didn't download during install
npm run dev        # desktop app with hot reload
npm run dev:web    # same UI in a browser tab at http://localhost:5173, real SQLite behind it (handy for UI work)
npm test           # data-layer tests (in-memory SQLite)
npm run build      # typecheck + production bundles
npm run pack       # unpacked Windows app: release/win-unpacked/InvoiceOn.exe (verified working)
npm run dist       # Windows installer (.exe) in release/
```

**Packaging note.** `npm run pack` works and produces a runnable `InvoiceOn.exe`. `npm run dist` (the NSIS
installer) additionally makes electron-builder download and unpack its own tools into
`%LOCALAPPDATA%\electron-builder\Cache`. On the dev machine that step failed with
`EPERM: operation not permitted, rename …7zip-win-x64…tmp` — Windows Defender (or another scanner) locking the
freshly extracted files. If you hit it, exclude that cache folder from real-time scanning, or run once from an
elevated terminal, then re-run. `electronDist` in `package.json` already reuses the installed Electron so the
main app payload isn't downloaded a second time. No app icon is set yet (default Electron icon) — a polish-stage item.

## Stack

- **Electron 44** shell, **React 19 + TypeScript + Tailwind 3** UI, bundled with **Vite**; main process bundled with esbuild.
- **SQLite via Node's built-in `node:sqlite`** — nothing native to compile, so packaging to an .exe stays simple.
  It's isolated in `electron/db/connection.ts`; moving to `better-sqlite3` later means changing that one file.
- Inter (weights 400/500 only) bundled locally so it works offline.

## Layout

```
electron/          main process: window, IPC, database, services
  db/              connection + transactions, versioned migrations (schema)
  services/        inventory, materials, settings, sample data — all business rules live here
  api.ts           binds services to the API contract, turns errors into user-safe messages
  bridge.ts        DEV ONLY http bridge so the UI can run in a browser tab
shared/            code + types used by both sides: API contract, money, stock rules
src/               React UI (pages/, components/, lib/)
tests/             data-layer tests
legacy-prototype/  the earlier single-file prototype, kept for reference; not part of the build
```

The renderer never touches the database or Node. It calls `window.invoiceon.invoke(method, args)` (see
`electron/preload.ts`), which reaches the typed `Api` in `shared/api.ts`.

## Data model (stage 1)

- **Design** = the SKU (`MG-001 Mau Silk Butidar`), with fabric and HSN code.
- **Variant** = one color in one size under a design. Owns its stock, reorder level, selling price and cost.
- **Cost per piece** = making/purchase cost + Σ (raw material qty × material price). Material prices are live,
  so changing the price of silk yarn revalues every variant that uses it.
- **Stock ledger** — `variants.stock` is the balance, `stock_movements` records every change (opening, purchase,
  production, return, adjustment, damage; `sale` reserved for invoicing) with running balance and unit cost.
  Stock can't go below zero.
- Money is integer **paise** everywhere; formatted with Indian digit grouping.
- Rows use UUID keys, `created_at`/`updated_at`, and soft deletes (`deleted_at`) so a future sync engine can
  reconcile devices. Archiving a design keeps old records that reference it valid.
- The database is at `%APPDATA%/InvoiceOn/invoiceon.db`, with a daily snapshot (last 14 kept) in `backups/`.

## Invoicing (stage 2)

- **Two kinds of invoice.** B2B is a GST *Tax Invoice*: needs the buyer's GSTIN and your own, shows HSN codes,
  place of supply and a tax summary. B2C is a plainer retail *Invoice*; the customer can be a walk-in.
- **One GST rate** (Settings, default 5%). Prices are stored **before GST**. Buyer in your state → CGST + SGST
  (half each); buyer elsewhere → IGST. A buyer with no state on file is treated as local. Totals round to the
  whole rupee with a visible round-off line. `shared/gst.ts` does the maths for both the live preview and the
  saved invoice, so they can't disagree.
- **Issued invoices are immutable** — they store frozen copies of seller, buyer, descriptions, HSN and prices, so
  editing a customer or design later never rewrites history. To change one, cancel it and issue a new one.
- **Stock moves through the ledger.** Issuing takes stock out (`sale`), and it refuses to oversell — the whole
  invoice rolls back if any line is short. Cancelling puts it back (`return`). Cancelled numbers are never reused.
- **Numbering** `MG/2026-27/0001`: prefix from Settings, Indian financial year (April–March), sequence restarts
  each year.
- **Print & PDF** render the same `InvoiceDocument` React component the screen shows, in a hidden window
  (`#/print/invoice/:id`), so paper matches preview. In browser dev mode these two buttons explain they need the
  desktop app. Set `INVOICEON_PDF_DIR` to make PDF export skip the save dialog (used by automated checks).
- Invoice status is derived, never stored: unpaid / partly paid / paid / overdue / cancelled.

## Payments & ledger (stage 3)

- **A payment is money received from a customer, split across invoices.** Whatever isn't on an invoice is that
  customer's **advance** — there's no separate advance balance to drift out of step.
- **Advance and invoice happen together.** On the New invoice screen, "Received now" records the payment in the
  same step as issuing the invoice. From Payments → Record payment, a pure advance leads with *Record & create
  invoice*, which carries the amount to the invoice screen. *Hold as advance* is there for when the invoice isn't
  ready (e.g. an order deposit); it's applied automatically to that customer's next invoice, or on demand from an
  open invoice ("Apply to this invoice").
- **Overpaying** an invoice holds the excess as advance. A payment with no customer (walk-in sale) must be applied in
  full — there's nobody to hold the rest for.
- **Nothing is deleted.** A mistake, bounced cheque or refund is *reversed* (voided): the invoice owes it again and
  the ledger shows the payment and its reversal. Cancelling a paid invoice returns the money to the customer's
  advance (walk-in payments are marked reversed).
- **Customer ledger** (customer page): invoices are debits, payments credits, with a running balance — positive means
  they owe you, negative means you hold their advance. Cancelled invoices and reversed payments stay visible with a
  matching reversal. The statement's balance always equals *outstanding − advance*, which the tests assert.
- **Dues** (Payments → Dues): who owes what, aged into not-yet-due / 1–30 / 31–60 / 61+ days past the due date.
- A customer who still owes money, or whose advance you hold, can't be archived.

Schema: `payments` + `payment_allocations` (migration 3). Existing databases upgrade in place.

## Reports (stage 4)

Reports → **Sales**, **GST**, **Stock valuation**. Sales and GST share a period picker: This month, Last month, This
quarter, This year, Last year, or a custom range. "Year" and "quarter" follow the Indian financial year (April–March).
The period lives in the URL, so switching tabs keeps it.

- **Sales shows two measures side by side.** *Invoiced* counts each invoice on its issue date; *collected* counts each
  payment on the day it arrived (reversed payments excluded). They differ whenever customers pay late or in advance, so
  both are shown — in the headline figures and in one chart, with a table view. Also: gross profit (taxable value less
  what the pieces cost, using the cost recorded at time of sale), what's still unpaid on the period's invoices, best-selling
  designs, top customers, B2B vs B2C, and how customers paid. Cancelled invoices are left out and counted.
- **GST is by invoice date** (when tax falls due). Totals split CGST/SGST/IGST and B2B/B2C, plus an HSN table, a B2B
  invoice register with buyer GSTINs, and a B2C summary by state and rate — the shapes a GSTR-1 asks for. An invoice's
  discount and tax are spread across its lines to the exact paisa (`allocate` in `shared/gst.ts`), so the HSN rows always add
  to the invoice totals.
- **Stock valuation** is current stock at cost (making/purchase cost + raw materials) and at selling price, by design,
  expandable to each variant with its last sale date. Pick a past date to rebuild quantities from the stock history; values
  use today's costs because past costs aren't kept. The cost total always equals the Inventory screen's stock value.
- **CSV export** on every tab (Excel-ready: UTF-8 with BOM, plain-number money). Desktop app: a save dialog. Browser dev
  mode: a normal download. `INVOICEON_EXPORT_DIR` skips the dialog for automated checks (it also covers PDF export).
- The chart's colours were checked with the dataviz palette validator: `#0B8264` (chart teal, brand teal made slightly
  more saturated so it doesn't read grey) for invoiced and `#B4842B` (deepened brand gold) for collected. Gold itself stays
  reserved for one highlight figure per screen.

## Polish (stage 5)

- **State changes move.** Headline figures (dashboard cards, report and customer figures) roll from their old value to the
  new one instead of jumping (`Money animate` / `rolling()` in `ui.tsx`); table rows ease in one after another; chart columns
  grow from the baseline; dialogs and toasts ease *out* as well as in. A dialog's exit works whoever closes it: as it unmounts
  it leaves an inert copy that fades away (`Modal.tsx`). All of it stops for people whose system asks for reduced motion.
- **Loading has a shape.** Lists show a pulsing table skeleton (opacity only — the brand has no gradients) instead of a
  spinner, so the page doesn't jump when rows arrive.
- **Navigation feels right.** Every page opens scrolled to the top with keyboard focus inside it. **Ctrl+N** starts a new
  invoice from anywhere.
- **Legibility.** The chart legend's date-basis text no longer uses a faded colour.
- **App icon.** `npm run` doesn't touch it; to regenerate after a logo change run
  `node_modules\electron\dist\electron.exe scripts\make-icon.cjs`. It writes `build/icon.png` and a multi-size
  `build/icon.ico`. The `.ico` is built by the script itself because giving electron-builder a PNG makes it download a
  converter tool, which hits the same `EPERM` described under *Packaging note* above.

## Dashboard, proformas, expenses (stage 6)

- **Dashboard.** One call (`dashboardOverview`, `electron/services/dashboard.ts`) returns everything shown: invoiced, received, outstanding and overdue for the chosen period, average payment time, the previous period for the arrows, the trend, aging, top clients and expenses by category. It reads the same records as the Sales report, and tests assert the chart points add up to the headline figures. Trend buckets are days (up to 3 weeks), weeks (up to 6 months) or months. **Aging is a picture of today** (everything owed, by invoice age) so the period menu doesn't apply to it.
- **Chart colours** are the same everywhere on the dashboard and were checked together with the dataviz palette validator: invoiced teal `#0B8264`, received bronze `#B4842B`, expenses brick `#A63D2F`. Every chart has a legend, hover values and a table view, so colour is never the only cue.
- **Proformas** are quotes: they freeze seller, buyer, prices and tax like an invoice does (same checks, same GST maths, `checkDocument` in `invoices.ts`), reserve no stock, and can include pieces you don't have. **Convert to invoice** creates a real invoice dated today at the quoted prices inside one transaction: if stock is short nothing changes. A quote lapses on its own after its valid-until date (derived, never stored). They print through the same document component as invoices (`variant="proforma"`).
- **Expenses** are soft-deleted; categories come from Settings, and "packaging"/"Packaging" are one category, spelled the way it was first entered.
- **Quick create** (`QuickCreate.tsx`) and the **command palette** (`CommandPalette.tsx`, Ctrl+K) are mounted once in the app shell.
- Schema migration 4 adds `expenses`, `proformas` and `proforma_lines`; existing databases upgrade in place.

## Bulk entry of sarees (stage 7)

- **Add sarees** (`src/pages/inventory/AddSareesPage.tsx`) is a sheet: one row per piece, paste from Excel, keyboard navigation, live totals. It calls `inventoryBulkAdd` → `bulkAddSarees` in `electron/services/inventory.ts`, which validates every row (alone, against the other rows and against the shop), then writes designs and variants in one transaction. Nothing is written unless every row is valid; problems come back one per row.
- Rows with the same normalised name (case and spacing ignored) form one design; a name matching an existing design extends it; two existing designs with one name are refused rather than guessed at.
- **MRP** is a new optional field on each variant (migration 5; `0` means not set). It is stored and shown, and is not used in invoice maths: prices stay GST-exclusive (SP), MRP is the printed GST-inclusive price.

## Credit notes and sales returns (stage 8)

- **A credit note corrects an issued invoice.** Open the invoice and choose *Credit note*. Two kinds: a **sales return** (pick the lines and how many pieces came back; each line says whether the pieces are resaleable) or a **price adjustment** (an amount off the price, before GST, with a printed reason). Like an invoice, a credit note is immutable and freezes seller, buyer, prices and tax. Numbering follows the financial year (`CN/2026-27/0001`, prefix in Settings, numbers never reused).
- **Credited at what the customer paid.** The invoice's discount is shared across its lines, so a returned piece is credited net of its discount share. Credits made over several visits add up to exactly the line's value (`shared/credit.ts`, used by both the server and the dialog's live preview). GST is worked out per rate (`taxByRate` in `shared/gst.ts`), which is also what multi rate invoices use.
- **Stock goes back through the ledger** (`return`) for resaleable pieces only. Cancelling a credit note takes them off the shelf again.
- **The money reuses the payments machinery**, so there is no second set of sums to drift. Whatever is not refunded becomes a payment with `source = 'credit_note'`: allocated to the invoice up to what is still owed, and held as the customer's advance beyond that. Outstanding, advance, dues and the ledger all stay consistent (the ledger's running balance still equals outstanding less advance). These bookkeeping payments are left out of *collected* figures and the Payments list. An optional **refund** (cash, UPI, bank) is recorded on the credit note; a walk-in sale must be refunded for anything the invoice no longer owes, since there is no account to hold a credit in.
- **Guards.** You cannot return more than was sold, credit more than the invoice was for, or cancel an invoice that has a live credit note (cancel the credit note first). A credit note with a refund cannot be cancelled.
- **Reports.** Sales figures stay gross and gain a *returns* strip (credit notes, refunds, net invoiced, net gross profit). The GST tab gains a credit note register (one row per note and rate, with the original invoice: the shape of GSTR-1's credit note table) and net GST. Both export to CSV.
- Schema migration 6 adds `credit_notes`, `credit_note_lines` and two columns on `payments`. Existing databases upgrade in place.

## Restore from backup (stage 9)

- **Settings, Data Management** lists every backup with a **Restore** button. Restoring replaces all your data with the copy you choose, then reloads the app.
- **It is safe by construction.** The backup is copied aside, brought up to the current schema (so an older backup restores fine), checked for damage and for having been made by a newer app, and only then is the live database refilled from it in **one transaction**: a failure leaves your data exactly as it was. Foreign keys are checked before committing.
- **A restore can be undone.** Just before anything changes, the current data is saved as `invoiceon-before-restore-<time>.db`. It appears in the same list (marked "Before a restore") and is never cleaned up automatically, like copies you make yourself.
- The connection stays open, so no restart is needed (`restoreBackup` in `electron/backup.ts`). Two backups in the same second get a counter on the file name rather than colliding.

## Several GST rates (stage 10)

- **Which rate a piece gets** (`resolveGstRate` in `shared/gst.ts`, used by the server and the invoice screen's live preview): the design's own rate if it has one, otherwise the **price step** it falls in (when the shop turns steps on in Settings, Tax Profiles: e.g. up to ₹2,500 at 5%, above that at 18%), otherwise the shop's single rate. The price used is the piece's selling price before GST, as typed on the invoice. `0%` is a real rate, not "unset".
- **Nothing changes until you use it.** With no design rates and steps off, every piece gets the shop rate and the totals come out exactly as before (a test compares the two code paths).
- **Documents record their rates.** Each line stores the rate it was taxed at, and the document stores its tax by rate (`tax_summary_json`). The printed invoice shows a GST column and one CGST/SGST (or IGST) row per rate when rates differ, plus a total row in the tax summary. Proformas work the same way; converting one re-applies today's rates, since tax follows the invoice date. Documents issued before this read as one rate for the whole document, exactly as they always did.
- **The discount is shared across the pieces** in proportion to their value before each rate's tax is worked out. Tax is rounded once per rate, and the invoice total to the whole rupee, as before.
- **Reports.** The GST report's HSN table and its B2B register have one row per HSN and rate (register rows per invoice and rate, with the round-off on the invoice's last row so rows add to the invoice total), and the retail summary is by state and rate. In the HSN CSV the rate is the last column, so existing columns keep their places. Credit notes on a mixed invoice credit each piece at the rate it was sold at.
- Schema migration 7 adds nullable rate columns and `tax_summary_json`. `tests/helpers/oldSchema.ts` holds the SQL that rewinds a database to an old shape for the upgrade tests: every migration adds its undo there.

## Suppliers and purchase bills (stage 11)

- **Purchases** (sidebar) has *Bills* and *Suppliers*. A supplier is like a customer: name, GSTIN, state, and a running statement. A **bill** is the supplier's own bill copied in: their bill number, dates, and items of three kinds: a **raw material** (metres or kilos), a **finished saree** (comes into stock through the ledger as a `purchase`, with the bill's cost), or **other** (freight, packing). Each item has its own GST rate. A supplier with no GSTIN cannot charge GST, so their bill must be at 0%.
- **Tax** is worked out per rate with the same helper invoices use (`taxByRate`): CGST + SGST when the supplier is in your state, IGST otherwise, rounded to the rupee. If the total printed on their bill differs by a few rupees, type it in (up to ₹5 either way is accepted as rounding; more means something is mistyped).
- **Bills freeze** the supplier's details and tax, and are cancelled rather than deleted. A cancelled bill takes its stock back out (refused if those pieces are already sold) and any money paid against it becomes an advance with the supplier. The same supplier bill number can't be entered twice while live, but can again after a cancellation.
- **Payables mirror receivables.** A payment to a supplier is split across their bills; what is left is an advance paid to that supplier, which can be set against a later bill. Outstanding and advance are worked out from the records, never stored; a payment can be reversed; the supplier ledger's running balance always equals outstanding less advance. *Payables* (`payablesReport`) ages what you owe by how far each bill is past its due date.
- **Optional cost update.** Tick "update costs to this bill's prices" and each raw material's cost, and the cost of sarees bought finished, follow the bill (a saree's own cost is its bill price less its raw materials). Off by default.
- **Input tax credit.** Bills marked eligible (default when the supplier has a GSTIN) feed the GST report's new *What you pay after input credit* table: output tax after credit notes, less input credit, set off in the order the rules require (`setOffInputCredit`: IGST credit against IGST, CGST, SGST; CGST or SGST credit against their own head, then IGST), giving cash payable and carry forward by head. Cancelled bills and bills marked not eligible are left out.
- Purchases do not appear in *Expenses*: expenses stay for day to day costs, bills for what you buy from suppliers. Schema migration 8 adds `suppliers`, `purchase_bills`, `purchase_bill_lines`, `supplier_payments` and `supplier_payment_allocations`.

## Weavers and job work (stage 12)

- **Purchases → Weavers.** A weaver has orders. An **order** (`WO/2026-27/0001`) is a number of pieces of one saree at a **wage per piece**, with an expected date. While it is open you can **hand over material** (yarn, zari; a minus quantity records leftover handed back) and **receive pieces** as they come, in as many parts as needed.
- **Receiving brings stock in through the ledger** (`production`). Pieces are refused if the number is far above the order (more than half as many again is almost always a typo); a few extra are fine. A receipt entered by mistake can be reversed: the pieces leave stock (refused if some are already sold) and the wage is no longer owed.
- **What you owe a weaver is worked out, never stored:** wages on receipts that have not been reversed, less payments. Paying before anything arrives is an advance (the balance goes negative). Payments can be reversed; the statement keeps every reversal and its running balance always equals what the weaver's page shows.
- **Real cost per piece** = the wage plus the raw material handed over (valued at its cost when issued) shared over the pieces ordered. Tick "set this saree's cost to what these really cost" on a receipt and the saree's making cost becomes that cost less the raw materials already in its costing, so stock valuation and margins use it.
- An order that came up short can be **closed** (what was received stays, and stays owed); one with nothing received can be **cancelled**. "Overdue" (open and past its expected date) and "received" are worked out, not stored. A weaver with open orders or money owed either way cannot be archived.
- Schema migration 9 adds `weavers`, `job_orders`, `job_order_materials`, `job_order_receipts` and `weaver_payments`.

## Barcode labels and scan to bill (stage 13)

- **Inventory → Labels** prints a label per saree: shop name, design, colour and size, a **Code 128 barcode of its SKU**, and the price (MRP if set, else the selling price plus GST). Choose how many of each (one button fills in what is in stock), the size (three roll sizes, or A4 sheets of 24 or 10), then **Print** or **Save PDF**. A design's page has a *Labels* button that starts with that design. In a plain browser the print view opens in a tab with a print button.
- **The encoder is ours, not a library** (`shared/barcode.ts`, Code 128 subset B: every printable ASCII character, which is all a SKU holds). It was checked three ways: against 696 strings from an independent implementation (bwip-js, identical output for every one, kept as reference vectors in `tests/barcode.test.ts`), structurally (11 modules a symbol, stop pattern, start B), and end to end: a label rendered by the app in a browser was decoded with ZXing and read back as exactly the SKU. A SKU with characters a barcode cannot hold (a Hindi name, an en dash) shows text instead and says so.
- **Print sizes.** A roll prints one label per page at the label's own size (`@page` for PDF; the desktop app also hands the printer the size in microns). A sheet packs a grid per A4 page. The request travels in the print page's address (`shared/labels.ts`) and is parsed defensively: unknown sizes fall back, malformed items are dropped, and the total is capped.
- **Scan to bill.** On New invoice (and New proforma), a scanner that types like a keyboard adds the saree whose SKU it reads, wherever focus is on the page (`useBarcodeScanner`): a burst of keys under 80 ms apart ending in Enter counts as a scan, so a person typing slowly, or pressing Enter alone, never does. Scanning the same label again adds one to the quantity; an unknown code or an out of stock saree says so. Typing an exact SKU in the item box and pressing Enter also wins over other search matches.

## Sharing, reminders and UPI QR (stage 14)

- **Share** on an invoice opens WhatsApp or your email program with a message ready: the invoice number, total and what is still due (and your UPI id). It is a link (`wa.me`, `mailto:`), so nothing is sent by InvoiceOn itself and you press send. A file cannot be handed to WhatsApp this way, so the PDF is attached by hand (Save PDF first); the menu says so. **Remind about payment** does the same with a reminder message, and the **Dues** screen has a *Remind* button per customer that lists their open invoices and what is overdue.
- **Numbers and links** (`shared/share.ts`, all pure and tested): Indian numbers get `91` (a leading 0 or `+91` is handled); a missing or impossible number opens WhatsApp's own contact chooser instead of a wrong chat. Messages come from templates in **Settings, Sharing & UPI** with `{placeholders}` and a live preview; an unknown or empty placeholder becomes nothing, so `{typo}` is never sent to a customer.
- **UPI QR.** Set your UPI id and invoices (and proformas) that still have something to pay print a QR code that opens a UPI app with the payee, the **balance due** and the invoice number filled in. It disappears once paid or cancelled. The id is live like the invoice's styling, so an older invoice shows your current one. The QR encoder is the small `qrcode-generator` library (the only dependency added for these features); a QR the app drew was decoded with ZXing and read back as the exact payment link, with the right amount.
- The desktop shell now also lets `mailto:` links through to the system.

## Activity log and "Check my books" (stage 15)

- **Every change is written to an activity log** as it happens: what was done, when and by whom, in plain sentences ("Cancelled invoice INV-0042", "Changed the price of Kanjivaram Red 5.5m from ₹4,500 to ₹4,800"). It lives in **Settings, Activity Log**, with search, a kind filter, a date range and CSV export. Nothing about the existing screens changes: the log is added by wrapping the API (`electron/audit.ts`, `withAudit`), so a call that fails writes nothing, and the log entry and the change it describes are saved together.
- **It cannot be quietly edited.** The table refuses `UPDATE` and `DELETE` (database triggers), and each entry carries a SHA-256 of the one before it, so a removed or altered entry breaks the chain. Restoring a backup never replaces the log.
- **Check my books** (Settings, Data Management) reads the whole database, changes nothing, and reports in plain words whether it all adds up: stock against its movements, invoice and proforma totals against their lines, numbering gaps, payments against what is owed, customer and supplier balances, credit notes, purchase bills, and the log's chain. Each check says what it looked at and, when something is off, exactly which record (`electron/services/integrity.ts`).

## Users, roles and PIN lock (stage 16)

- **Off until you turn it on.** Until then InvoiceOn behaves exactly as before. **Settings, Users & Access** turns it on: you give your name and a PIN and become the owner, then add people. PINs are 4 to 8 digits, stored only as a salted scrypt hash, and a person who gets the PIN wrong five times waits 30 seconds (and it is logged).
- **Three roles.** The *owner* can do everything, including settings, backups, users and the log. A *manager* sells, cancels, manages stock, purchases, weavers, expenses and reports. *Counter staff* sell (invoices, quotes, customers, payments) and cannot see costs or profit, cancel, or change stock. The screens hide what a role cannot use, and the data layer enforces it regardless (`shared/access.ts`): every API call needs one capability, and a call nobody has classified needs the owner, so a call added later is closed by default. Cost and profit fields are zeroed for counter staff before they leave the data layer.
- **Locking.** The app shows a PIN pad (people picked by name, digits from the keyboard work) whenever nobody is signed in. It locks itself after a chosen number of idle minutes (Settings, Users & Access; 0 means never), and the lock button in the sidebar locks it at once. Anyone can change their own PIN (it needs the old one). Turning sign-in off needs the owner's PIN. Restoring a backup never turns sign-in off or brings old PINs back, and the activity log records who did what under their own name.

## GSTR-1, e-invoice and e-way bill files (stage 17)

- **Reports, GST, "Files for the GST portals"** prepares three JSON files from the invoices and credit notes in the chosen period. InvoiceOn never connects to a portal: you save the file and upload it yourself. Each file is made to the published layout, and everything the export noticed comes back as a "Check before you upload" list (a bad buyer GSTIN, a missing or short HSN, a pincode that is not 6 digits, an invoice number the e-invoice portal would refuse, a rate that is not a standard slab).
- **GSTR-1** (`electron/services/filing.ts`): B2B invoices by buyer GSTIN with one item per tax rate; B2CL (inter-state consumer invoices above ₹2.5 lakh) by state; B2CS (all other consumer sales) totalled by state and rate; credit notes as CDNR (registered buyers) or CDNUR (large consumer notes), while small consumer returns come off the B2CS total; the HSN summary (net of returns, quantities only reduced by real returns); and the document series with cancelled counts per financial year. Your aggregate turnover is left as 0 for you to fill in. The return period is the month of the end date, and a range over several months is flagged.
- **e-Invoice**: one record per B2B invoice and credit note (`Typ` INV or CRN, a credit note pointing at its invoice), with each item's discount share, taxable value and tax worked out to the paisa, so the items add up to the invoice total including round off. B2C invoices are left out, as they get no IRN.
- **e-Way bill**: for invoices above ₹50,000 (or the ones you pick), with both places, the goods and, if you have them, the transport details (mode, distance, vehicle, transporter, document). Unregistered buyers go as `URP`.
- **What was and was not verified.** The sums are checked by tests (sections add up to the invoices, items add up to each invoice, credit notes reverse correctly). The layouts follow the portals' published JSON schemas as I know them, but no portal or offline tool was available here to import the files, so run the first file through the portal's own validator before relying on it, and keep a human in the loop for anything filed.

## Off-site copy (stage 18)

- **Settings, Data Management, Off-site copy** keeps a second copy of the database in a folder you choose: one that Google Drive, OneDrive or Dropbox syncs, or a USB drive or network share. A copy is made when you turn it on, once a day when the app opens, and whenever you press *Copy now*; the newest 30 are kept and files in the folder that are not InvoiceOn's own are never touched. A copy is written to a temporary name and renamed, so a half written copy never appears, and a missing drive is reported on the screen instead of stopping the app.
- **Optional encryption** (`electron/offsite.ts`): AES-256-GCM with a key from your passphrase (scrypt), the header authenticated too, so a wrong passphrase, a flipped bit or an edited header are all refused rather than producing garbage. The passphrase is never stored; the derived key is, on this computer, so the daily copy can encrypt without asking. On a new computer the passphrase alone opens a copy. Tests show an encrypted file contains neither the business name nor the SQLite header.
- **Restore from off-site** goes through the same careful restore as any backup (safety copy first, schema brought up to date, damage checked). Restoring any backup keeps this computer's off-site setup, so restoring an old copy never turns the copies off or changes the key.
- **Not included, on purpose:** live sync between two computers. That needs a server that both talk to, which this offline app does not have. A synced folder gives safe off-site copies, not simultaneous editing on two machines.

## Phone view (stage 19)

- **Settings, Phone View** switches on a small read only web page that the shop computer serves on its own Wi-Fi (`electron/mobile.ts`). Scan the QR code shown there, or type the address, on a phone on the same network: **Today** (sold today, the month, to collect, overdue, stock), **Dues** (who owes the most, with a tap to call), **Stock** (search by design, colour or SKU) and **Invoices** (the latest 30). It refreshes itself and works on any phone with no app to install.
- **Read only by construction.** The server is not the app's API: it has a fixed handful of read functions that return only safe figures, answers nothing but `GET`, and never sends a cost, profit or margin (a test lists the exact fields). The page runs under a strict content policy (a fresh nonce per load, `default-src 'none'`, no inline styles) and puts every figure on the screen as text, never as markup.
- **A secret link, and it is yours to revoke.** Off until switched on, remembered across restarts, answering only to a 128 bit random link compared in constant time. Guessing is slowed (20 wrong tries a minute, then a pause) while the right link is never turned away. **Make a new link** kills the old one at once, for a lost phone or a departed staff member. It stops with the app and takes the next free port if the usual one is busy.
- **Honest limits.** It is plain `http` on a local address, not encrypted on the way, so use it on your own Wi-Fi. It works only while InvoiceOn is open on the shop computer, and not from outside the shop: reaching it from anywhere needs a server in the middle, which this offline app does not have. Windows may ask to allow network access the first time.

## Design photos and a shareable catalogue (stage 20)

- **Photos.** A design's page has a *Photos* panel: add up to six pictures (several at once), choose which is the cover, remove any. The app shrinks each one before saving (about 1000 px and about 100 KB, plus a small thumbnail for lists; any JPEG, PNG or WebP a browser can read), and the server checks again that the bytes really are that kind of picture, within size, and within the limit, so a renamed script can never be stored as a photo. Photos live in the database, so every backup and off-site copy carries them, and a restore brings them back. The inventory list shows each design's cover.
- **Catalogue** (Inventory, Catalogue). Choose the designs (or use them all), a title, whether to show prices and only what is in stock, and two or three designs per row. The preview is the real page; *Save PDF* makes a file to send on WhatsApp, *Print* prints it, and in a browser it opens a print page. Each design shows its photo, code, fabric, the colours (with "out" marked when out of stock is included) and a price: the MRP range when every piece has an MRP, otherwise the selling price range plus GST. Costs are never part of it. Like labels, the request travels in the print page's address and is parsed defensively.

## Offers and loyalty points (stage 21)

- **Offers** (Settings, Offers & Loyalty): a named discount with rules: a percentage or a flat amount, a minimum bill, the whole bill or one design, and a first and last day. On *New invoice* the Offer box lists the ones running that day with what each would save, and the chosen offer is taken off together with any discount typed in. The maths is one shared function (`shared/offers.ts`) used by the screen's preview and by the data layer that really issues the invoice, so the two cannot disagree; the data layer re-checks that the offer is running and applies to the bill, and refuses the invoice if not, leaving stock untouched. The invoice keeps the offer's name (frozen, like the seller's address) and prints "of which offer: Diwali 10% off" under the discount.
- **Loyalty points**: off until switched on. A saved customer earns whole points on the taxable value after discount (for example 1 point per ₹100), and can spend points as part of the discount (for example ₹1 a point, a minimum per use). A ledger records every change (`loyalty_entries`); the balance is always the sum, never a stored figure. Cancelling an invoice takes back what it earned and gives back what it spent; a credit note takes back the share the returned goods earned (never more than was earned, across several returns), and cancelling the credit note gives it back. Points that were spent are not refunded on a return. The customer's page shows the balance and history, with a manual *Adjust* (with a reason) for managers and owners.
- **Nothing existing changes.** An invoice's `discount_paise` is still the whole discount, so every total, tax figure, report and credit note works exactly as before; the new columns only record how the discount was made up.

## Dues follow-up and promises to pay (stage 22)

- **Who has been chased.** The Dues screen now shows under each customer when they were last contacted and what they promised, and **Remind** (WhatsApp) records itself as a contact. **Follow up** logs a call, visit or other contact with a note and, in the same step, an optional *promise to pay* (an amount by a day). A customer's page has a Follow-ups card with their promises and contact log.
- **Promises are judged from the books, not typed in.** A promise is *kept* once money (not a credit note) has been received from that customer since it was made, to the promised amount, even in pieces; it stays *open* through the promised day, and is *broken* the day after if the money did not come. Reversing a payment un-keeps it. Only the facts are stored (`customer_contacts`, `payment_promises`), the state is worked out on every read (`shared/followup.ts`), so it can never disagree with the payments.
- **Worth chasing today.** The *Only customers to follow up* filter lists customers who are overdue, have no promise still to come, and either broke a promise or have not been contacted for a week. Counter staff can log follow-ups; nothing here changes what is owed.

## Restock suggestions and dead stock (stage 23)

- **Inventory, Restock** (owners and managers, since it shows costs) says what to make or buy and what has stopped selling. It only reads.
- **The rule, in full.** For each piece: pieces sold over the look-back period (90 days by default; issued invoices less returns on credit notes, cancelled invoices ignored) give a speed per day. That is projected over the lead time plus the days a batch should last (21 and 30 by default), and the pieces already on the shelf and already owed by open weaver orders are taken off. The answer is rounded up and is never negative; a piece with a reorder level is never allowed below it, even if it is not selling. A piece is *running out* when it sells and is gone, or will be, before a new batch could arrive, unless a batch is already on order. All four numbers can be changed on the page, and the page shows its reasoning. The list exports to CSV for ordering.
- **Dead stock.** Pieces on the shelf with no sale for 90 days (changeable), or never sold and added that long ago, with the cost tied up, costliest first. A piece added recently gets that long to sell. A link goes to Offers, one way to free the money.
- The maths is in `shared/insights.ts` and is unit tested, including on-order, returns, cancelled invoices and each setting.

## Stock in other places (stage 24)

- **Inventory, Places** keeps track of stock kept away from the shop: a godown, an exhibition stall, a relative's shop. **The shop is the selling location**: "in stock" everywhere (invoices, low stock, barcode scan, the design page) is still what is on the shop's shelves, so selling works exactly as before and pieces in the godown cannot be sold until they are brought back.
- **Moves.** *Move stock* shifts pieces between the shop and a place, or between two places, with a note. The shop's side goes through the normal stock ledger ("Moved to Godown", "Brought back from Godown" appear in a saree's stock history) and is refused with "Not enough stock" if the shop cannot cover it; a place cannot give away more than it holds. What a place holds is the sum of its moves in less out (`stock_transfers`), never a stored figure. A place can be closed only when empty.
- **Still counted as yours.** Pieces away from the shop count towards the inventory page's units and value, the stock valuation report (now and as of a past day), and Restock (pieces in a godown can be brought back, so they count as on hand when deciding what to make or buy). Low stock alerts and selling stay shop only.
- **Checked.** Check my books adds a check that no place has given away more than it received and that every move touching the shop has its matching entry in the stock ledger.

## Physical stock take (stage 25)

- **Inventory, Stock take** (owners and managers). Start a count of every saree, or of one design, then walk the shelves and type in how many of each there are (or scan the SKU barcodes: each scan adds one). The page shows the books' figure beside yours and the difference, with filters for *Not counted* and *Differences* and a running total of pieces over and short and what that does to stock value at cost. *Count sheet* exports a blank sheet (deliberately without the books' figures) to count from on paper. The count survives closing the app, so it can be carried over several days.
- **Selling carries on.** Each count records what the books said at the moment that saree was counted, and the difference is measured against that, so a sale made after you counted cannot turn a correct count into a false shortage. On *Finish and apply*, each difference becomes a normal stock adjustment ("Stock take: <name>" in the saree's history, in the activity log and in the stock ledger the books check reads); sarees not counted are left exactly as they are, and if sales since the count mean a shortage would take stock below zero, stock is set to zero and the page says which ones.
- **Safe to abandon.** *Cancel count* throws the counts away and changes nothing. One count can be open at a time, so two people do not count against each other. Finished counts are listed with what they found.

## Invoice layouts and several businesses (stage 26)

- **Layouts** (Settings, Invoice Settings): choose *Classic* (the original, a coloured rule under the header), *Modern* (a colour band at the top) or *Minimal* (thin lines, no colour block); show or hide the colour, size and SKU under each item and the total in words; and give retail (B2C) bills their own heading such as CASH MEMO. A GST tax invoice always says TAX INVOICE and a proforma always says PROFORMA INVOICE. Like the logo and colour, layouts are applied when an invoice is shown or printed, so a change restyles old invoices too, without touching their content; the live preview beside the form is the real invoice component. They live in a separate `style` object, so the existing `branding` of an invoice is untouched.
- **Businesses** (Settings, Businesses, desktop app only): keep more than one business in one installation. Each has its **own database, backups, off-site copies, people and PINs, settings and numbering**, so nothing in one can show in another. The original business stays exactly where it always was (the app's data folder); each one added lives in its own folder under `businesses/`. *Open* switches in one step: the current business's data is closed, the other opened, and the app reloads. A business can be renamed, or taken off the list; taking it off never deletes a file. The list is a small JSON file written whole (never half), a damaged one is set aside and the app carries on with the original business, and a folder that points outside the data folder is refused.
- **Tested and not tested.** The registry (adding, switching, renaming, unlisting, isolation of data between businesses, damaged and hostile files) is covered by tests, and the switch glue in the desktop shell type checks and bundles. Switching businesses inside a running Electron window could not be exercised here, since there was no desktop to run it on, so try it once after installing.

## Import and getting started (stage 27)

- **Import customers** (Customers, Import): choose a CSV file, or paste cells copied from Excel or Google Sheets. Columns are recognised from their headings however the old sheet named them (Party Name, Mobile No., GST No, Town, PIN, Remarks and so on), a list with no headings is read as name, phone, city, GSTIN, and unused headings are reported. Spreadsheet quirks are put right: `9876543210.0` and `9.87654E+9` phone numbers, `UP` or `MH` as a state, spaces in a GSTIN; a GSTIN makes a B2B customer and fills in the state. Each row goes through the same checks as adding a customer by hand.
- **Preview, then import.** *Check the list* is a dry run that does all the work and then undoes it, so the preview is exactly what importing does. People already on file (same GSTIN, same phone number by its last ten digits, or same name in the same city) and repeats inside the list are skipped and explained; rows with a problem are listed and left out while the good ones still go in. Up to 2000 at a time. What customers owe is deliberately not imported: old dues belong in invoices and payments. Sarees already have a paste-from-spreadsheet sheet (Inventory, Add sarees).
- **Getting started** card on the dashboard: five steps (business details, sarees, customers, first invoice, a copy off the computer), each ticking itself from the data, with a link to where it is done, closing by itself when all five are done or when hidden. It is worked out on the server (`electron/services/onboarding.ts`), never stored, apart from the hidden flag.

## Brand

Tokens live in `tailwind.config.js` (teal `#0F6E56`, gold `#D9A94E` for one figure per screen, status pairs, ink).
Tailwind's font weights are restricted to 400/500, so heavier weights can't be used by accident. Money and counts
use tabular figures (`.num`).
