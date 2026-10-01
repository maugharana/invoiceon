# InvoiceOn

Windows desktop invoicing and inventory app for small businesses, built first for Mau Gharana (sarees). Offline first, data in a local SQLite file. Read README.md for the full data model and business rules before changing anything.

## Stack
Electron 44, React 19, TypeScript, Tailwind 3, Vite. SQLite through node:sqlite (isolated in electron/db/connection.ts).

## Live preview commands
- `npm run dev:web` runs the UI in a browser at http://localhost:5173 with the real SQLite data layer. Use this for UI work. Saved edits hot reload.
- `npm run demo` runs the same with a throwaway database full of sample data. Safe to experiment.
- `npm run dev` runs the real Electron desktop app with hot reload (main process restarts on change).
- `npm test` runs data layer tests. `npm run typecheck` checks types.

## Rules for changes
- The renderer never touches the database or Node. UI calls window.invoiceon.invoke(method, args), typed in shared/api.ts.
- All business rules live in electron/services/. GST maths lives in shared/gst.ts and is used by both preview and saved invoices.
- Money is integer paise everywhere. Format with the helpers in shared/ (Indian digit grouping).
- Issued invoices are immutable. Stock changes only through the stock ledger. Rows use UUIDs and soft deletes.
- Schema changes need a new versioned migration in electron/db/. Never edit an old migration.
- Brand: teal #0F6E56, gold #D9A94E (one highlight figure per screen), off white #FAFAF7, ink #1A1D1B. Inter weights 400 and 500 only, tabular figures (.num) for money and quantities. No gradients, no heavy shadows, 8px radius on cards and buttons, 12px on containers, subtle motion that respects reduced motion.
- After any change: run `npm run typecheck` and `npm test`, then confirm the result in the preview.
- Work one feature at a time and keep diffs small.
