# InvoiceOn — a guided tour

Follow this in order. It takes about ten minutes.

## 1. See how it looks

```bash
npm run demo
```

That starts InvoiceOn in your browser at **http://localhost:5173** with realistic sample data in every tab, and opens it for you.
Stop it with `Ctrl+C`.

- The data lives in a throwaway database (`.dev-data/demo`) that is **rebuilt from scratch every time**. Change or delete anything you
  like — it never touches your real data, and it never touches anything you enter under `npm run dev:web`.
- Everything is fictional. The sample business GSTIN (`09AAACH7409R1ZZ`) and bank details are made up.

### What each tab shows

| Tab | What you'll see |
|---|---|
| **Dashboard** | A one-line briefing (what's overdue, what's low, which quotes are waiting), four headline figures with a trend line and an up/down arrow against the period before, average payment time, then charts: invoice aging, top clients, revenue trend (received vs expenses), invoiced vs received, and expenses by category. The period menu (top right) filters everything except the aging chart, which is always "owed today". Every chart has a chart/table switch. |
| **Proformas** | 4 quotes: two open (one for pieces you don't have yet), one expired, one cancelled. Open one to see how it prints, and try **Convert to invoice**: it turns into a real invoice at the quoted prices, or tells you which piece is short and changes nothing. |
| **Expenses** | 9 expenses over two months across the standard categories. Filter by category or period; the same figures feed the dashboard. |
| **Inventory → Add sarees** | The quickest way to enter stock: a sheet with one row per piece (weave style, fabric, technique, pattern, special work, colour, special name, size, MRP, SP, CP, stock). Paste a block from Excel, or type across with Tab and down with Enter. The copy button on a row starts the next colour of the same saree. See below. |
| **Inventory → Designs** | 5 sarees with colours and sizes. Open one to see per-variant stock, cost (built from raw materials) and margin. One is out of stock, several are low. |
| **Inventory → Raw materials** | 6 materials (silk yarn, zari…) whose prices feed each saree's cost. |
| **Invoices** | 6 invoices: B2B with CGST+SGST, B2B with IGST (other state), B2B not yet due, B2C paid by UPI, a walk-in paid in cash with a discount, and one cancelled. |
| **Customers** | 4 customers (2 B2B, 2 B2C) with what they owe or hold in advance. Open one for their ledger. |
| **Payments** | 4 payments — one is an *advance* (a deposit for a booking). |
| **Payments → Dues** | Who owes what, aged by how late it is. |
| **Reports → Sales** | Invoiced vs collected (by invoice date and by payment date), profit, best sellers, top customers. Try *This year*. |
| **Reports → GST** | Tax by CGST/SGST/IGST, B2B register, B2C by state, HSN summary, CSV export. |
| **Reports → Stock valuation** | Stock at cost and at selling price; click a design to expand its variants. |
| **Settings** | Ten sections down the left: Business Profile, Tax Profiles, Invoice Settings, Proforma Settings, Expense Categories, Payment Accounts, Payment Instructions, Notifications, Data Management, Preferences (step 4). |

### Adding many sarees at once

Inventory → **Add sarees** (or the **+** button, or press **S** with it open).

- **One row is one piece**: a saree in one colour and size. Rows with the same name (built from the choices, or typed in *Own name*) become one design with several colours; a design you already have takes the new colours (the row says "Adds to MG-003").
- **Special name** is your own name for the saree, a word or a short phrase, like "Lalima" or "Rang Bahar". It's optional and goes last in the saree's full name. Rows with the same choices and special name become one design with several colours. Search and the invoice item picker find sarees by it.
- **Saree ID (SKU)** is optional: leave it blank and one is made from the design code, colour and size.
- **MRP** is the printed price with GST. **SP** (selling price) and **CP** (cost price) are before GST, and SP and CP are what invoices and margins use. You get a warning (never a block) if SP is above MRP or below CP.
- **Paste from Excel or Google Sheets**: copy the cells (in the order Weave style, Fabric, Technique, Pattern, Special work, Colour, Special name, Size, MRP, SP, CP, Stock), click the first cell here, paste. A header row is skipped automatically. *More columns* adds an own name (to name a saree yourself), Saree ID, HSN and reorder level.
- **All or nothing.** Every row is checked first; if any has a problem (missing colour, a Saree ID already in use, the same colour and size twice…) nothing is added and each problem is shown against its row.

**Create anything from anywhere.** The round **+** button (bottom right) fans out New invoice, New proforma, New expense, New customer and Record payment. With it open, press the letter shown on each (I, P, E, C, R). **Ctrl+K** opens a search box that finds any customer, invoice, proforma or design and can also create things or jump to any page. **Ctrl+N** still starts a new invoice.

## 2. Generate a PDF

Open **Invoices**, click any invoice, then:

- **In the desktop app:** click **Save PDF**, choose where to save it, done. **Print** opens the normal Windows print dialog.
- **In the browser preview (`npm run demo`):** click **Save PDF**. The invoice opens in a new tab with a bar at the top. Click
  **Save as PDF / Print**, then in the print window set the *Destination / Printer* to **Save as PDF** and press **Save**. (Your browser
  suggests the invoice number as the file name.)

Both use exactly the same invoice layout, so what you see on screen is what you get on paper.

## 3. See how the PDF looks

Real PDFs, generated by the desktop app from the sample data, are in **`sample-pdfs/`**:

| File | Shows |
|---|---|
| `1 - B2B tax invoice - same state…` | GSTIN, HSN, CGST+SGST, part-payment, balance due, bank details, terms, signature |
| `2 - B2B tax invoice - other state (IGST)…` | IGST instead of CGST+SGST, place of supply in another state |
| `3 - B2B tax invoice - not yet due.pdf` | An unpaid invoice with a future due date |
| `4 - B2C retail invoice - paid by UPI.pdf` | The simpler retail layout (no HSN column or tax breakup) |
| `5 - B2C walk-in - discount, paid in cash.pdf` | A walk-in customer, a discount, round-off |
| `6 - Cancelled invoice (watermark).pdf` | The CANCELLED watermark and reason |
| `7 - Proforma - B2B quote…` | A quote: "PROFORMA INVOICE", "Valid until", tax shown for information, and a note that it is not a tax invoice |
| `8 - Proforma - B2C quote.pdf` | The retail version |
| `9 - Proforma - cancelled…` | The same watermark as a cancelled invoice |
| `customized/…` | The same layouts with a logo, a maroon colour and a different closing note (step 4) |

## 4. Customise the PDF

Go to **Settings**. The sections that shape the PDF show a live preview of it; press **Save changes** (top right) to keep your edits. Edits stay in place while you move between sections, so you can change several and save once.

| You can change | Where | Where it appears |
|---|---|---|
| **Logo** | Business Profile | Top-left of every invoice. Upload PNG/JPEG/WebP/SVG; it's shrunk automatically. |
| **Business name, address, GSTIN, phone, email** | Business Profile | Top of the invoice. |
| **GST rate** | Tax Profiles | The tax lines. Shows how ₹1,000 is taxed in-state and out-of-state. |
| **Invoice colour** | Invoice Settings | The title, the line under the header, and the closing note. Six presets, or any custom colour. |
| **Closing note** | Invoice Settings | A line at the very bottom, e.g. "Thank you for shopping with us!" |
| **Signature box** | Invoice Settings | Show or hide "Authorised signatory". |
| **Terms, invoice prefix, payment days** | Invoice Settings | Bottom of the invoice; the number, e.g. `MG/2026-27/0001`; the due date. |
| **Bank / UPI details** | Payment Instructions | A "Pay to" block at the bottom, so customers know where to send money. "Fill from my payment accounts" writes it for you. |

The other sections: **Proforma Settings**, **Expense Categories** and **Payment Accounts** are saved now but nothing uses them yet (proformas, expense entry and per-account payment tracking aren't built). **Notifications** turns the count badges in the left menu on or off. **Data Management** shows where your data is, lists backups and has **Back up now** and **Load sample data**. **Preferences** holds the default reorder level.

**What changes old invoices and what doesn't.** Address, GSTIN, terms, bank details and the closing note are saved onto each invoice when
it is issued, so editing them never alters an invoice you have already sent (that is what a tax invoice must do). The **logo, colour and
signature box** are only styling, so a new logo or colour restyles every invoice, old ones included.

**Changing the layout itself** (moving blocks, adding a column) means editing one file: `src/components/InvoiceDocument.tsx`. The screen,
the print dialog and the PDF all use it, so one change updates all three.

## Where to go next

- `npm run dev` — the real desktop app with hot reload.
- `docs/WINDOWS-ISSUES.md` — the two Windows errors you may hit when packaging, and how to fix them.
