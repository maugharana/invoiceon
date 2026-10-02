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
| 7 | Bulk entry, imports, stock-take, print documents, look and wording | **Done** |
| 8–15 | Customer details and notes, quote lifecycle, payment accounts and cheques, vendors and input GST, raw-material stock and purchases, notifications and activity log | **Done** |

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

## Customers, quotes, money, materials and the shell (stages 8–15)

Migrations 8 to 13. Each has an upgrade test (`tests/upgrade.test.ts`) that builds a populated book at the previous version, upgrades it, and checks the backfills.

- **Customers (8).** Tags, a credit limit (0 = none, warns on a new invoice but never blocks), payment terms (days; sets the due date when set, otherwise the shop's default), birthday/anniversary (month and day only; a 29 February date falls on the 28th in other years), extra addresses and contacts. `notes` is one timeline for customers, quotes and invoices; a *follow-up* or *promise to pay* has a day and can be ticked off, and the open ones feed the dashboard, the dues list and the notifications.
- **Prices (8).** `price_history` gets a row when a variant is created and whenever its selling price, MRP or cost changes (all changes go through `updateVariant`, bulk price changes included).
- **Invoices (9).** `series` + `seq` are unique per year: with a B2B prefix set (Settings → Invoice), B2B tax invoices count on their own; the two prefixes must differ. Ship-to is frozen at issue because it is printed; carrier, tracking and delivery status are the only things on an issued invoice that can change (`invoiceSetDelivery`), as they aren't part of the tax document.
- **Quotes (10).** Statuses are derived: open → expired (past date) → partial (some lines invoiced) → converted (all invoiced) / lost / cancelled. Partial conversion invoices chosen quantities (`proforma_lines.invoiced_qty`); the quoted discount is shared out by value and the last part takes what is left so the invoices carry exactly what was quoted. Cancelling an invoice made from a quote gives its pieces back to the quote. A deposit is a payment with `proforma_id`; it is held as the customer's advance and put toward the invoice when one is made. Editing writes the earlier version to `proforma_revisions`.
- **Payments (11).** `kind` is `receipt` or `writeoff`. **A write-off is never money in**: every "received" query filters `kind = 'receipt'` (dashboard, reports, day book, payments summary, accounts, advance), and cancelling an invoice voids its write-offs instead of turning them into advance. A cheque with a date is tracked pending → deposited → cleared; it counts as received when recorded and a bounce reverses it. `reconciled_on` is set only after the person confirms a statement match (`shared/reconcile.ts` proposes). Each payment and bill can name a payment account (`account_id`, an id from Settings); balances are opening + receipts − paid bills ± transfers (`electron/services/accounts.ts`), and entries with no account sit under "not linked". The day close compares a cash count with the cash accounts' book balance and only notes the difference.
- **Expenses (11).** Vendors build themselves from the "Paid to" text (case-insensitive). `gst_paise` is the input GST inside `amount_paise`. Profit and loss counts spending before that GST; the cash views count a bill only once paid, on `paid_on`. Standing expenses are entered with one click when due (never silently). Monthly budgets live in Settings (`expenseBudgets`).
- **Raw materials (12).** `stock_qty` is a cached balance with a ledger (`material_movements`), like finished stock; quantities are rounded to a thousandth. A purchase adds stock, makes the price just paid the material's price (history in `material_prices`), and can create the matching expense in the same transaction. A costing line's cost includes its wastage percent. The what-if simulator (`simulateMaterialPrices`) changes nothing. Places: the shop is the default; `stock_locations` holds only what is kept elsewhere, and sales and write-offs draw only on the shop's share.
- **The shell (13).** Every API call that changes something writes one line to `audit_log` from `createApi` (a description, never the data; a log that can't be written never fails the change). Notifications are derived on every call from the books (`electron/services/notifications.ts`), nothing is stored; "read" is remembered per computer in the browser. Held bills are rows in `held_bills` and touch no stock or money.

Not built, on purpose: photos, barcodes/QR labels, credit notes and returns, per-line discounts, multi-rate GST, e-invoice/e-way bill, users and roles, auto-update, production orders and job work. Sync/teams are planned for InvoiceOn Plus.

## Backup, restore and Google Drive

Code: `electron/backup.ts` (files on this computer, checking and restoring), `electron/drive.ts` (Google), `electron/backupService.ts` (puts them together). Tests: `tests/backup-drive.test.ts`, which includes a stand-in for Google.

- **Where copies go.** Daily and "Back up now" copies land in `backups/` in the data folder. Two more destinations are optional: an extra folder (pen drive, other disk) and Google Drive. A failure at one destination is noted on the screen and never stops the others or the app.
- **Settings are kept outside the book** (`backup-settings.json`, `google-drive.json` in the data folder), so restoring an old book never changes where this computer sends backups or which Google account it uses.
- **Google.** The owner makes a Google Cloud "Desktop app" client (steps are shown in Settings > Backup & Restore) and pastes the ID and secret. Sign-in is the standard desktop flow: the browser opens, Google sends a one-time code back to a port on 127.0.0.1, checked against a PKCE challenge and a random `state`. Only the narrow `drive.file` permission is asked for, so InvoiceOn sees just the "InvoiceOn backups" folder it made. The secret and sign-in token are encrypted with the Windows account (Electron `safeStorage`). A Google app left in "Testing" signs out every 7 days; publishing it ("In production") avoids that.
- **Online retention.** Automatic uploads are named `invoiceon-YYYY-MM-DD.db`, one per day, and the oldest beyond the chosen number are removed. Files made by hand are never removed by the app.
- **Restore never swaps a live book.** A restore checks the file (opens read-only, integrity check, the right tables, not from a newer version), writes a "before restore" copy of the current book, stages the file as `restore-pending.db`, and restarts. On the next start, before the book opens, the file is swapped in; if that fails the old book is kept. Old journal files are removed so they can't be paired with the new book.
- **What a backup holds.** The whole book. Backups are not encrypted: anyone with the file can read it, so keep the pen drive and the Google account safe.

## Item discounts, several GST rates and round-off

Code: `shared/gst.ts` (`computeInvoice`, `resolveRate`, `roundTotal`), migration 14, `tests/money-maths.test.ts`.

- **One function works out every invoice.** `computeInvoice` takes lines that each have a price, an optional discount of their own and a GST rate. It spreads the invoice-level discount over the lines by value, works the tax out **once per rate** (not once per line, so a one-rate invoice comes to exactly what it always did), and shares each rate's taxable value and tax back to the lines to the exact paisa. The server (when issuing) and the screen (while typing) both use it, so the preview is the saved number. `computeTotals` is the one-rate shortcut.
- **Which rate a line gets, in order:** a rate typed on the line, the design's own rate, a price slab (pieces priced up to a limit get a rate; compared with what one piece sells for after the line's discount, as entered), the shop's usual rate. Slabs are set by the owner in Settings > Tax Profiles; the app ships with none, so no tax rule is assumed.
- **Stored per line:** `gst_rate_percent`, `line_discount_paise`, `note`, and the line's own `taxable_paise` and `tax_paise`. `amount_paise` stays quantity × price (before the line's discount). Invoices made before migration 14 got their own rate copied onto each line and have no per-line tax; reports share the invoice's figures over its lines as they always did, so nothing in an old book changes.
- **Reports.** The GST report lists a row for each rate on an invoice (the invoice total sits on the first row only, so a column adds up), the B2C-by-state table splits by rate, and HSN totals use each line's own taxable value. The tax summary on an invoice is `taxByRate`.
- **Quotes.** A quote keeps each line's discount, note and **resolved rate**. Converting it passes that rate on as typed, so a later change to slabs or rates cannot alter what was promised. A line's discount is shared over part invoices by quantity, each part taking the difference in what the pieces invoiced so far would carry, so the parts add up to exactly the line's discount.
- **Round-off.** `roundOff` in settings: nearest rupee (the default, and what every earlier invoice used), up, down, or none (exact paise). The difference is its own line on the invoice. Rounding is applied once, to the grand total.

## Credit notes, returns and refunds

Code: `electron/services/credits.ts`, `payments.ts` (credit and refund kinds), migration 15, `tests/credit-notes.test.ts`.

- **A credit note is its own immutable document** with its own numbering (`CN/2026-27/0001`; the prefix is a setting). It reverses chosen quantities of one invoice's lines; the invoice itself is never edited. A credit note cannot be cancelled, and an invoice with credit notes can no longer be cancelled (a mistake is corrected by billing again).
- **Exact to the paisa.** Each line's taxable value and tax (stored per line since migration 14; older invoices have the invoice's figures shared over the lines) are shared out by quantity, each return taking the difference between what the pieces returned so far would carry and what they carry now. Returns in any number of parts therefore add up to exactly the line. A note that takes back the last of an invoice is worth exactly what is left of it, rounding included. Otherwise the total is rounded by the shop's round-off setting.
- **The money.** The credit is first put toward what is still owed on the invoice (a payment of kind `credit` allocated to it, so the invoice's balance and status follow; it is not money received). If the customer had already paid, what is left over must be chosen: `refund` (a payment of kind `refund`, money out, from a chosen account) or `credit` (kept as the customer's credit, a `credit` payment left unallocated, used like any advance). A walk-in sale can only be refunded.
- **Stock.** Pieces marked "resell" go back through the stock ledger (reason `return`, referencing the note). Damaged pieces do not, and stay a cost in the profit figures.
- **Held money and refunds.** `advanceHeld` now counts `receipt` and `credit` payments less any refund whose `refund_of` points at them. `refundAdvance` hands back advance or credit the customer is holding, oldest money first. A payment that has been refunded cannot be reversed until the refund is; a `credit` cannot be reversed at all.
- **Books.** Sales, profit, GST and the dashboard are net of credit notes, dated by the credit note. The GST report's totals are net and `credits` says what came off; it also lists a credit-note register (one row per rate) and a CSV. HSN, B2C-by-state and designs are net too. Refunds are money out in the account book, day/cash/bank book, collected figures and the customer's ledger. The ledger shows each credit note once and each refund.
- **Migration 15** rebuilds the `payments` table, because SQLite cannot change a CHECK in place. The migrator switches foreign keys off around a migration marked `rebuilds` and checks them before committing, as SQLite's own instructions for this say; the upgrade test builds a book with payments, allocations and a cheque and checks every row survives.

## Pictures

Code: `electron/services/photos.ts`, `src/components/PhotoStrip.tsx`, `src/lib/images.ts`, migration 16, `tests/photos.test.ts`.

- **Kept inside the book**, as small JPEGs the screen makes before sending (about 100 KB, longest side 1200 px, plus a 240 px thumbnail for lists). A backup is therefore always one file that holds the pictures, and a restore can never leave pictures behind.
- **Where.** Up to 10 on a design, 6 on a colour, 4 on an expense (a photo of the bill). The first is the cover; a design with none of its own shows its first colour's. Lists ask for covers only for the designs on the page (`photoCovers`), and the full picture is fetched only when opened.
- **Removing** drops the picture's bytes and keeps the row, so the book does not grow with pictures nobody can see.
- **Inventory** has a List / Pictures switch (remembered per computer).
- Pictures are not part of the spreadsheet export.

## Barcodes, labels and the quick bill

Code: `shared/code128.ts`, `src/components/Barcode.tsx`, `src/pages/inventory/Labels.tsx`, `src/pages/invoices/QuickBillPage.tsx`, migration 17, tests in `tests/code128.test.ts` and `tests/photos.test.ts`.

- **Every colour and size is scannable by its SKU.** The labels the shop prints carry the SKU as a Code 128 barcode (drawn as vector bars, so any size and any scanner works). A piece that came with a printed barcode can store it too (`variants.barcode`, optional). A code can belong to only one piece, and a barcode may not equal another piece's SKU, so a scan never finds two.
- **Scanners are keyboards.** They type the code and press Enter, so no driver is needed: the item box on the invoice screen and the quick bill take an exact SKU or barcode (any case) and add that piece, ahead of whatever else matches the text.
- **Labels.** On a design: Print labels, a count for each colour and size (stock on hand to start with), three across, name, colour and size, price and barcode. In the browser it opens a page to Save as PDF; in the desktop app it prints.
- **Quick bill** (Invoices > Quick bill): scan or type, change quantities with + and −, press Cash, UPI or Card. One walk-in bill is issued, paid in full, in one step, then the next customer. Ctrl+Enter takes cash. Named customers, item discounts and part payment use the full invoice screen. The maths is the same `computeInvoice` the invoice uses.

## Holding stock for a quote, production orders and job work

Code: `electron/services/reservations.ts`, `electron/services/production.ts`, `src/pages/inventory/ProductionPage.tsx`, migration 18, `tests/production.test.ts`.

- **Holding stock.** A quote can hold its pieces (`proformas.reserve_stock`). They stay on the shelf and in the stock ledger, but `stock − held` is all anyone else can sell: an invoice that would eat into pieces held by another live quote is refused, naming the quote. A hold ends by itself when the quote is invoiced, lost, cancelled or past its date; the quote it is held for can always take its own pieces (`exceptQuoteId`). A hold can only be placed on pieces that are really there and not already held. Quotes that hold nothing may still promise more than exists.
- **Production orders and job work are one thing.** An order is "make N of this colour and size", in-house or by a karigar from the vendors list at a wage per piece (`PRD/2026-27/0001`). Needs are the costing's quantity with its wastage, times N. Materials come off the shelf all at once when work starts (or when the first pieces arrive), refused whole if any is short. Finished pieces go on the shelf through the stock ledger as they arrive, in any number of batches; each batch raises an unpaid "Job work" bill to the karigar for pieces × wage. The last piece finishes the order. Closing early gives back only the materials for pieces never made; cancelling (before anything arrives) gives back all. Orders past their due date appear in notifications.

## Loyalty points and wishlist

Code: `electron/services/loyalty.ts`, `src/pages/customers/CustomerExtras.tsx`, migration 19, `tests/loyalty.test.ts`.

- **Points are a ledger** (`loyalty_points`), like stock: earned, redeemed, reversed, adjusted, with the balance as their sum. Off until Settings > Preferences says how many rupees earn a point (`loyaltySpendPaise`; 0 = off); a point is worth `loyaltyPointValuePaise` (₹1 by default).
- **Earning** is on the invoice total, for saved customers only. **Spending** is part of the invoice's discount (the screen's "Use N points"); the server checks the balance and that the discount covers the points' value. **Cancelling** an invoice gives spent points back and removes earned ones; **a credit note** removes the points earned on that much of the sale. Removals never take a balance below zero. Hand adjustments need a reason.
- **Wishlist.** Designs a customer asked for. When one has stock, a notification says so; buying the design takes it off the list.

## Signing in, roles, a receipt slip, a second window and the GSTR-1 file

Code: `shared/roles.ts`, `electron/services/users.ts`, the gate in `createApi` (`electron/api.ts`), `src/pages/SignInScreen.tsx`, `src/pages/settings/UsersSection.tsx`, `electron/services/gstr.ts`, `src/components/SlipDocument.tsx`, migration 20; tests `tests/auth.test.ts`, `tests/gstr.test.ts`.

- **Sign-in is optional.** A shop that never turns it on works as before. Settings > People & sign-in makes the first person the owner (name and a 4-8 digit PIN) and shows a **recovery code once**, the only way back from a forgotten owner PIN. From then on nothing works until someone signs in, and every call is checked against the signed-in person's role.
- **Roles.** Owner (everything), Counter staff (sell, quote, take payments, look after customers, take goods back; no expenses, reports or settings), Accountant (payments, expenses, bills, reports, GST; cannot sell or change stock or settings). `shared/roles.ts` is an allow-list per role: a call not named there is refused, and `tests/auth.test.ts` fails if a new API call is not deliberately placed, so nothing new is open to staff by accident. Roles guard what people can *do* and which money screens they can open; a cashier can still see cost prices in stock lists.
- **Session.** Kept in the one process that owns the book, not on the screen. A change of role or a removal takes effect on the person's very next action. Five wrong PINs pause that person for 30 seconds. PINs are stored only as salted scrypt hashes. The activity log records who did each thing, plus signing in, out and PIN changes.
- **A PIN does not lock the data file.** Anyone with the computer can still copy `invoiceon.db`; keep the computer and the backups safe.
- **80 mm receipt slip.** Invoice > Receipt, and after a quick bill: a short text-only receipt sized for a thermal roll.
- **Second window.** Ctrl+Shift+N in the desktop app opens another window on the same book (the sign-in is shared).
- **GSTR-1 file.** Reports > GST > Prepare GSTR-1 for a single month: B2B invoices by buyer with tax by rate, B2C totalled by in/out of state, rate and state (credit notes to retail buyers come off these), credit notes to businesses, the HSN summary net of credit notes, and the documents issued. It is built from the same data as the GST report, which the tests compare to the paisa. It is for you to upload; InvoiceOn files nothing, and the portal's own check on upload is the final word, so read the warnings first. Unit code is PCS; descriptions in the HSN table are left blank.

Not built: dark mode and alternative invoice layouts. Both are about how the screens look and are best done after the screens have their final design, to avoid doing them twice.

## Brand

Tokens live in `tailwind.config.js` (teal `#0F6E56`, gold `#D9A94E` for one figure per screen, status pairs, ink).
Tailwind's font weights are restricted to 400/500, so heavier weights can't be used by accident. Money and counts
use tabular figures (`.num`).
