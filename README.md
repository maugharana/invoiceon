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

## Brand

Tokens live in `tailwind.config.js` (teal `#0F6E56`, gold `#D9A94E` for one figure per screen, status pairs, ink).
Tailwind's font weights are restricted to 400/500, so heavier weights can't be used by accident. Money and counts
use tabular figures (`.num`).
