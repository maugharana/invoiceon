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

## Brand

Tokens live in `tailwind.config.js` (teal `#0F6E56`, gold `#D9A94E` for one figure per screen, status pairs, ink).
Tailwind's font weights are restricted to 400/500, so heavier weights can't be used by accident. Money and counts
use tabular figures (`.num`).
