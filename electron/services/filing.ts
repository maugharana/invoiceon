import { allocate, isIsoDate, isValidGstin, type RateGroup } from '../../shared/gst';
import { B2CL_LIMIT_PAISE, EWAY_LIMIT_PAISE, EWAY_MODE, STANDARD_RATES, filingPeriod, isPortalDocNumber, portalDate, stateCodeOf, toRupees, type FilingFile, type FilingRequest } from '../../shared/filing';
import type { InvoiceType, Party } from '../../shared/types';
import { all, type Db } from '../db/connection';
import { UserError } from './common';
import { loadInvoices } from './reports';
import { getSettings } from './settings';

// Files for the government portals: the GSTR-1 return, e-invoice (IRN) uploads and e-way bill uploads. InvoiceOn prepares the files; it
// never connects to the portals. Each file is made to the published JSON layout and should be checked by the portal's own tool on import,
// which is why every export also returns a list of things to look at first.

const r2 = toRupees;
const isPin = (p: string) => /^[1-9]\d{5}$/.test(p.trim());
const validHsn = (h: string) => /^\d{4,8}$/.test(h.trim());
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

// ── Loading ─────────────────────────────────────────────────────────────────
interface NoteRow {
  id: string;
  number: string;
  seq: number;
  fy: string;
  kind: 'return' | 'adjustment';
  issue_date: string;
  status: 'issued' | 'cancelled';
  intra_state: number;
  buyer_json: string;
  place_of_supply: string;
  tax_summary_json: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  invoice_number: string;
  invoice_date: string;
  invoice_type: InvoiceType;
  invoice_intra: number;
  invoice_total_paise: number;
}

interface NoteLine {
  credit_note_id: string;
  design_name: string;
  color: string;
  hsn: string;
  qty: number;
  unit_price_paise: number;
  amount_paise: number;
  taxable_paise: number;
  gst_rate_percent: number;
}

interface Note {
  row: NoteRow;
  buyer: Party;
  groups: RateGroup[];
  lines: NoteLine[];
  /** Each line's share of the note's tax, to the exact paisa. */
  shares: { cgst: number; sgst: number; igst: number }[];
}

function loadNotes(db: Db, range: { from: string; to: string }, includeCancelled = false): Note[] {
  const rows = all<NoteRow>(
    db,
    `SELECT c.id, c.number, c.seq, c.fy, c.kind, c.issue_date, c.status, c.intra_state, c.buyer_json, c.place_of_supply, c.tax_summary_json, c.taxable_paise, c.cgst_paise, c.sgst_paise,
       c.igst_paise, c.round_off_paise, c.total_paise, i.number AS invoice_number, i.issue_date AS invoice_date, i.type AS invoice_type, i.intra_state AS invoice_intra, i.total_paise AS invoice_total_paise
     FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id
     WHERE c.issue_date BETWEEN ? AND ? ${includeCancelled ? '' : "AND c.status = 'issued'"} ORDER BY c.issue_date, c.seq`,
    range.from,
    range.to,
  );
  if (rows.length === 0) return [];
  const lines = all<NoteLine>(
    db,
    `SELECT l.credit_note_id, l.design_name, l.color, l.hsn, l.qty, l.unit_price_paise, l.amount_paise, l.taxable_paise, l.gst_rate_percent
     FROM credit_note_lines l JOIN credit_notes c ON c.id = l.credit_note_id WHERE c.issue_date BETWEEN ? AND ? ORDER BY l.position`,
    range.from,
    range.to,
  );
  return rows.map((row) => {
    const mine = lines.filter((l) => l.credit_note_id === row.id);
    const groups = JSON.parse(row.tax_summary_json) as RateGroup[];
    const shares = mine.map(() => ({ cgst: 0, sgst: 0, igst: 0 }));
    for (const g of groups) {
      const at = mine.map((_, i) => i).filter((i) => mine[i]!.gst_rate_percent === g.ratePercent);
      if (at.length === 0) continue;
      const weights = at.map((i) => mine[i]!.taxable_paise);
      const cgst = allocate(g.cgstPaise, weights);
      const sgst = allocate(g.sgstPaise, weights);
      const igst = allocate(g.igstPaise, weights);
      at.forEach((lineIndex, k) => (shares[lineIndex] = { cgst: cgst[k]!, sgst: sgst[k]!, igst: igst[k]! }));
    }
    return { row, buyer: JSON.parse(row.buyer_json) as Party, groups, lines: mine, shares };
  });
}

/** The state code a document is supplied to: the place of supply's, else the buyer's GSTIN's. */
function posCode(place: string, buyerGstin: string): string | null {
  return stateCodeOf(place) ?? (isValidGstin(buyerGstin) ? buyerGstin.trim().slice(0, 2) : null);
}

function checkRange(range: { from: string; to: string }): void {
  if (!isIsoDate(range?.from) || !isIsoDate(range?.to)) throw new UserError('Choose a valid date range.');
  if (range.from > range.to) throw new UserError('The start date is after the end date.');
}

function requireSellerGstin(db: Db): { gstin: string; code: string } {
  const gstin = getSettings(db).gstin.trim().toUpperCase();
  if (!isValidGstin(gstin)) throw new UserError('Add a valid GSTIN in Settings, Business Profile first. These files are made out in it.');
  return { gstin, code: gstin.slice(0, 2) };
}

const plainNumber = (n: number) => Math.round(n * 100) / 100;

// ── GSTR-1 ──────────────────────────────────────────────────────────────────
interface Heads {
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
}
const addHeads = (a: Heads, g: { taxablePaise: number; igstPaise: number; cgstPaise: number; sgstPaise: number }, sign = 1): void => {
  a.txval += sign * g.taxablePaise;
  a.iamt += sign * g.igstPaise;
  a.camt += sign * g.cgstPaise;
  a.samt += sign * g.sgstPaise;
};

const itemOf = (g: RateGroup, num: number, inter: boolean) => ({
  num,
  itm_det: inter ? { txval: r2(g.taxablePaise), rt: g.ratePercent, iamt: r2(g.igstPaise), csamt: 0 } : { txval: r2(g.taxablePaise), rt: g.ratePercent, camt: r2(g.cgstPaise), samt: r2(g.sgstPaise), csamt: 0 },
});
/** For B2B, credit notes and the like, the portal takes all three heads on each item. */
const itemOfAll = (g: RateGroup, num: number) => ({ num, itm_det: { txval: r2(g.taxablePaise), rt: g.ratePercent, iamt: r2(g.igstPaise), camt: r2(g.cgstPaise), samt: r2(g.sgstPaise), csamt: 0 } });

function gstr1(db: Db, range: { from: string; to: string }): FilingFile {
  const { gstin, code: sellerCode } = requireSellerGstin(db);
  const invoices = loadInvoices(db, range);
  const notes = loadNotes(db, range);
  const warnings: string[] = [];
  const fromMonth = range.from.slice(0, 7);
  if (fromMonth !== range.to.slice(0, 7)) warnings.push('This range spans more than one month. GSTR-1 is filed for one month (or one quarter); the period in the file is the month of the end date.');

  const pos = (place: string, buyerGstin: string, doc: string): string => {
    const code = posCode(place, buyerGstin);
    if (code) return code;
    warnings.push(`${doc}: the place of supply "${place}" is not a known state, so ${sellerCode} (your own state) was used.`);
    return sellerCode;
  };

  const rateCheck = new Set<number>();
  const b2b = new Map<string, unknown[]>();
  const b2cl = new Map<string, unknown[]>();
  const b2cs = new Map<string, Heads & { sply_ty: 'INTRA' | 'INTER'; rt: number; pos: string }>();
  const cdnr = new Map<string, unknown[]>();
  const cdnur: unknown[] = [];
  const hsn = new Map<string, { hsn: string; desc: string; rt: number; qty: number; val: number } & Heads>();
  const counts = { b2b: 0, b2cl: 0, b2cs: 0, cdnr: 0, cdnur: 0 };
  let taxable = 0;
  let tax = 0;

  const bucket = (sply: 'INTRA' | 'INTER', rt: number, p: string): Heads & { sply_ty: 'INTRA' | 'INTER'; rt: number; pos: string } => {
    const key = `${sply}|${rt}|${p}`;
    let b = b2cs.get(key);
    if (!b) b2cs.set(key, (b = { sply_ty: sply, rt, pos: p, txval: 0, iamt: 0, camt: 0, samt: 0 }));
    return b;
  };

  for (const inv of invoices) {
    const r = inv.row;
    const p = pos(r.place_of_supply, inv.buyerGstin, `Invoice ${r.number}`);
    inv.groups.forEach((g) => rateCheck.add(g.ratePercent));
    taxable += r.taxable_paise;
    tax += r.cgst_paise + r.sgst_paise + r.igst_paise;
    const inter = r.intra_state !== 1;
    if (r.type === 'B2B') {
      if (!isValidGstin(inv.buyerGstin)) warnings.push(`Invoice ${r.number}: the buyer's GSTIN "${inv.buyerGstin}" is not valid, and the portal will refuse it.`);
      const entry = { inum: r.number, idt: portalDate(r.issue_date, '-'), val: r2(r.total_paise), pos: p, rchrg: 'N', inv_typ: 'R', itms: inv.groups.map((g, i) => itemOfAll(g, i + 1)) };
      const key = inv.buyerGstin.trim().toUpperCase();
      b2b.set(key, [...(b2b.get(key) ?? []), entry]);
      counts.b2b += 1;
    } else if (inter && r.total_paise > B2CL_LIMIT_PAISE) {
      const entry = { inum: r.number, idt: portalDate(r.issue_date, '-'), val: r2(r.total_paise), itms: inv.groups.map((g, i) => itemOf(g, i + 1, true)) };
      b2cl.set(p, [...(b2cl.get(p) ?? []), entry]);
      counts.b2cl += 1;
    } else {
      for (const g of inv.groups) addHeads(bucket(inter ? 'INTER' : 'INTRA', g.ratePercent, p), g);
      counts.b2cs += 1;
    }
    for (const l of inv.lines) {
      const key = `${l.hsn}|${l.ratePercent}`;
      let h = hsn.get(key);
      if (!h) hsn.set(key, (h = { hsn: l.hsn, desc: clip(l.designName, 30), rt: l.ratePercent, qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0 }));
      h.qty += l.qty;
      h.txval += l.taxable;
      h.iamt += l.igst;
      h.camt += l.cgst;
      h.samt += l.sgst;
      h.val += l.taxable + l.igst + l.cgst + l.sgst;
    }
  }

  for (const n of notes) {
    const r = n.row;
    const p = pos(r.place_of_supply, n.buyer.gstin, `Credit note ${r.number}`);
    n.groups.forEach((g) => rateCheck.add(g.ratePercent));
    const inter = r.intra_state !== 1;
    const registered = r.invoice_type === 'B2B';
    const base = { nt_num: r.number, nt_dt: portalDate(r.issue_date, '-'), val: r2(r.total_paise), inum: r.invoice_number, idt: portalDate(r.invoice_date, '-') };
    if (registered) {
      if (!isValidGstin(n.buyer.gstin)) warnings.push(`Credit note ${r.number}: the buyer's GSTIN "${n.buyer.gstin}" is not valid, and the portal will refuse it.`);
      const entry = { ntty: 'C', ...base, pos: p, rchrg: 'N', inv_typ: 'R', itms: n.groups.map((g, i) => itemOfAll(g, i + 1)) };
      const key = n.buyer.gstin.trim().toUpperCase();
      cdnr.set(key, [...(cdnr.get(key) ?? []), entry]);
      counts.cdnr += 1;
    } else if (r.invoice_intra !== 1 && r.invoice_total_paise > B2CL_LIMIT_PAISE) {
      cdnur.push({ typ: 'B2CL', ntty: 'C', ...base, pos: p, itms: n.groups.map((g, i) => itemOf(g, i + 1, true)) });
      counts.cdnur += 1;
    } else {
      // Small sales to consumers are reported in total by state and rate, so a return comes off that total.
      for (const g of n.groups) addHeads(bucket(inter ? 'INTER' : 'INTRA', g.ratePercent, p), g, -1);
    }
    n.lines.forEach((l, i) => {
      const key = `${l.hsn}|${l.gst_rate_percent}`;
      let h = hsn.get(key);
      if (!h) hsn.set(key, (h = { hsn: l.hsn, desc: clip(l.design_name, 30), rt: l.gst_rate_percent, qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0 }));
      if (r.kind === 'return') h.qty -= l.qty;
      h.txval -= l.taxable_paise;
      h.iamt -= n.shares[i]!.igst;
      h.camt -= n.shares[i]!.cgst;
      h.samt -= n.shares[i]!.sgst;
      h.val -= l.taxable_paise + n.shares[i]!.igst + n.shares[i]!.cgst + n.shares[i]!.sgst;
    });
    taxable -= r.taxable_paise;
    tax -= r.cgst_paise + r.sgst_paise + r.igst_paise;
  }

  const odd = [...rateCheck].filter((x) => !STANDARD_RATES.includes(x));
  if (odd.length) warnings.push(`Some lines are taxed at ${odd.map((x) => `${x}%`).join(', ')}, which is not one of the standard GST rates (0, 0.25, 3, 5, 12, 18, 28).`);
  const noHsn = [...hsn.values()].filter((h) => !validHsn(h.hsn));
  if (noHsn.length) warnings.push(`${noHsn.length === 1 ? 'One HSN code is' : `${noHsn.length} HSN codes are`} missing or not 4 to 8 digits${noHsn.some((h) => !h.hsn.trim()) ? ' (some sarees have none set)' : ''}. The portal needs a valid HSN on every row.`);

  // Document series: what was issued, what was cancelled, by financial year.
  const series = (table: 'invoices' | 'credit_notes') => {
    const rows = all<{ fy: string; seq: number; number: string; status: string }>(db, `SELECT fy, seq, number, status FROM ${table} WHERE issue_date BETWEEN ? AND ? ORDER BY fy, seq`, range.from, range.to);
    const byFy = new Map<string, typeof rows>();
    for (const x of rows) byFy.set(x.fy, [...(byFy.get(x.fy) ?? []), x]);
    return [...byFy.values()].map((list) => {
      const cancel = list.filter((x) => x.status === 'cancelled').length;
      return { from: list[0]!.number, to: list[list.length - 1]!.number, totnum: list.length, cancel, net_issue: list.length - cancel };
    });
  };
  const docs = [
    { doc_num: 1, docs: series('invoices').map((d, i) => ({ num: i + 1, ...d })) },
    { doc_num: 5, docs: series('credit_notes').map((d, i) => ({ num: i + 1, ...d })) },
  ].filter((d) => d.docs.length > 0);

  const sections: Record<string, unknown> = {};
  if (b2b.size) sections.b2b = [...b2b].map(([ctin, inv]) => ({ ctin, inv }));
  if (b2cl.size) sections.b2cl = [...b2cl].map(([p, inv]) => ({ pos: p, inv }));
  const small = [...b2cs.values()].filter((b) => b.txval !== 0 || b.iamt !== 0 || b.camt !== 0 || b.samt !== 0);
  if (small.length) {
    sections.b2cs = small.map((b) => ({ sply_ty: b.sply_ty, rt: b.rt, typ: 'OE', pos: b.pos, txval: r2(b.txval), ...(b.sply_ty === 'INTER' ? { iamt: r2(b.iamt) } : { camt: r2(b.camt), samt: r2(b.samt) }), csamt: 0 }));
  }
  if (cdnr.size) sections.cdnr = [...cdnr].map(([ctin, nt]) => ({ ctin, nt }));
  if (cdnur.length) sections.cdnur = cdnur;
  if (hsn.size) {
    sections.hsn = {
      data: [...hsn.values()].sort((a, b) => b.txval - a.txval).map((h, i) => ({ num: i + 1, hsn_sc: h.hsn, desc: h.desc, uqc: 'PCS', qty: h.qty, rt: h.rt, val: r2(h.val), txval: r2(h.txval), iamt: r2(h.iamt), camt: r2(h.camt), samt: r2(h.samt), csamt: 0 })),
    };
  }
  if (docs.length) sections.doc_issue = { doc_det: docs };

  const fp = filingPeriod(range.to);
  const json = { gstin, fp, gt: 0, cur_gt: 0, ...sections };
  const summary = [
    `Return period ${fp.slice(0, 2)}/${fp.slice(2)} for ${gstin}.`,
    `${counts.b2b} invoices to registered buyers (B2B), ${counts.b2cl} large inter-state consumer invoices (B2CL), ${counts.b2cs} other consumer invoices (B2CS, totalled by state and rate).`,
    `${counts.cdnr} credit notes to registered buyers, ${counts.cdnur} to consumers (large).`,
    `Taxable value ${plainNumber(taxable / 100).toFixed(2)}, tax ${plainNumber(tax / 100).toFixed(2)}, after credit notes.`,
  ];
  warnings.push('Aggregate turnover (gt and cur_gt) is left as 0: fill it in on the portal or the offline tool. Check the file there before you file.');
  return { filename: `GSTR1 ${fp.slice(2)}-${fp.slice(0, 2)}.json`, content: JSON.stringify(json, null, 2), count: counts.b2b + counts.b2cl + counts.b2cs + counts.cdnr + counts.cdnur, summary, warnings };
}

// ── e-invoice ───────────────────────────────────────────────────────────────
function sellerDetails(seller: Party, fallbackGstin: string, warnings: string[], doc: string) {
  const gstin = (seller.gstin || fallbackGstin).trim().toUpperCase();
  if (!isPin(seller.pincode)) warnings.push(`${doc}: your pincode "${seller.pincode}" is not a 6 digit pincode.`);
  if (seller.city.trim().length < 3) warnings.push(`${doc}: your city is missing or shorter than 3 letters.`);
  if (!seller.address.trim()) warnings.push(`${doc}: your address is missing.`);
  return { Gstin: gstin, LglNm: seller.name, Addr1: clip(seller.address || seller.city, 100), Loc: seller.city, Pin: Number(seller.pincode) || 0, Stcd: gstin.slice(0, 2) };
}

function buyerDetails(buyer: Party, place: string, warnings: string[], doc: string) {
  const gstin = buyer.gstin.trim().toUpperCase();
  if (!isValidGstin(gstin)) warnings.push(`${doc}: the buyer's GSTIN "${buyer.gstin}" is not valid.`);
  if (!isPin(buyer.pincode)) warnings.push(`${doc}: the buyer's pincode "${buyer.pincode}" is not a 6 digit pincode.`);
  if (buyer.city.trim().length < 3) warnings.push(`${doc}: the buyer's city is missing or shorter than 3 letters.`);
  const code = posCode(place, gstin) ?? gstin.slice(0, 2);
  return { Gstin: gstin, LglNm: buyer.name, Pos: code, Addr1: clip(buyer.address || buyer.city, 100), Loc: buyer.city, Pin: Number(buyer.pincode) || 0, Stcd: gstin.slice(0, 2) };
}

function eInvoice(db: Db, range: { from: string; to: string }): FilingFile {
  const { gstin } = requireSellerGstin(db);
  const warnings: string[] = [];
  const out: unknown[] = [];
  const invoices = loadInvoices(db, range).filter((i) => i.row.type === 'B2B');
  for (const inv of invoices) {
    const r = inv.row;
    const doc = `Invoice ${r.number}`;
    if (!isPortalDocNumber(r.number)) warnings.push(`${doc}: the portal takes invoice numbers of at most 16 letters, digits, "/" and "-". Shorten the invoice prefix in Settings.`);
    const seller = JSON.parse(r.seller_json) as Party;
    const buyer = JSON.parse(r.buyer_json) as Party;
    const items = inv.lines.map((l, i) => {
      if (!validHsn(l.hsn)) warnings.push(`${doc}: "${l.designName}" has no valid HSN code (4 to 8 digits).`);
      return {
        SlNo: String(i + 1),
        PrdDesc: clip([l.designName, l.color].filter(Boolean).join(' '), 300),
        IsServc: 'N',
        HsnCd: l.hsn.trim(),
        Qty: l.qty,
        Unit: 'PCS',
        UnitPrice: r2(l.unitPricePaise),
        TotAmt: r2(l.amountPaise),
        Discount: r2(l.amountPaise - l.taxable),
        AssAmt: r2(l.taxable),
        GstRt: l.ratePercent,
        IgstAmt: r2(l.igst),
        CgstAmt: r2(l.cgst),
        SgstAmt: r2(l.sgst),
        TotItemVal: r2(l.taxable + l.igst + l.cgst + l.sgst),
      };
    });
    out.push({
      Version: '1.1',
      TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
      DocDtls: { Typ: 'INV', No: r.number, Dt: portalDate(r.issue_date, '/') },
      SellerDtls: sellerDetails(seller, gstin, warnings, doc),
      BuyerDtls: buyerDetails(buyer, r.place_of_supply, warnings, doc),
      ItemList: items,
      ValDtls: { AssVal: r2(r.taxable_paise), CgstVal: r2(r.cgst_paise), SgstVal: r2(r.sgst_paise), IgstVal: r2(r.igst_paise), CesVal: 0, RndOffAmt: r2(r.round_off_paise), TotInvVal: r2(r.total_paise) },
    });
  }
  const notes = loadNotes(db, range).filter((n) => n.row.invoice_type === 'B2B');
  for (const n of notes) {
    const r = n.row;
    const doc = `Credit note ${r.number}`;
    if (!isPortalDocNumber(r.number)) warnings.push(`${doc}: the portal takes numbers of at most 16 letters, digits, "/" and "-".`);
    const seller = JSON.parse(all<{ seller_json: string }>(db, 'SELECT seller_json FROM credit_notes WHERE id = ?', r.id)[0]!.seller_json) as Party;
    const items = n.lines.map((l, i) => {
      if (!validHsn(l.hsn)) warnings.push(`${doc}: "${l.design_name}" has no valid HSN code (4 to 8 digits).`);
      const s = n.shares[i]!;
      return {
        SlNo: String(i + 1),
        PrdDesc: clip([l.design_name, l.color].filter(Boolean).join(' '), 300),
        IsServc: 'N',
        HsnCd: l.hsn.trim(),
        Qty: l.qty,
        Unit: 'PCS',
        UnitPrice: r2(l.unit_price_paise),
        TotAmt: r2(l.amount_paise),
        Discount: r2(l.amount_paise - l.taxable_paise),
        AssAmt: r2(l.taxable_paise),
        GstRt: l.gst_rate_percent,
        IgstAmt: r2(s.igst),
        CgstAmt: r2(s.cgst),
        SgstAmt: r2(s.sgst),
        TotItemVal: r2(l.taxable_paise + s.igst + s.cgst + s.sgst),
      };
    });
    out.push({
      Version: '1.1',
      TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
      DocDtls: { Typ: 'CRN', No: r.number, Dt: portalDate(r.issue_date, '/') },
      SellerDtls: sellerDetails(seller, gstin, warnings, doc),
      BuyerDtls: buyerDetails(n.buyer, r.place_of_supply, warnings, doc),
      PrecDocDtls: [{ InvNo: r.invoice_number, InvDt: portalDate(r.invoice_date, '/') }],
      ItemList: items,
      ValDtls: { AssVal: r2(r.taxable_paise), CgstVal: r2(r.cgst_paise), SgstVal: r2(r.sgst_paise), IgstVal: r2(r.igst_paise), CesVal: 0, RndOffAmt: r2(r.round_off_paise), TotInvVal: r2(r.total_paise) },
    });
  }
  const summary = [`${invoices.length} invoices and ${notes.length} credit notes to registered buyers (B2B).`, 'Consumer (B2C) invoices are left out: they do not get an IRN.'];
  warnings.push('Generate the IRN from this file on the e-invoice portal (bulk upload) or through your GST software; InvoiceOn does not connect to the portal. Only businesses above the e-invoicing turnover limit need this.');
  return { filename: `e-invoice ${range.from} to ${range.to}.json`, content: JSON.stringify(out, null, 2), count: out.length, summary, warnings };
}

// ── e-way bill ──────────────────────────────────────────────────────────────
function eWay(db: Db, req: FilingRequest): FilingFile {
  const range = { from: req.from, to: req.to };
  const { gstin, code: sellerCode } = requireSellerGstin(db);
  const warnings: string[] = [];
  const pool = loadInvoices(db, range);
  const chosen = req.invoiceIds?.length ? pool.filter((i) => req.invoiceIds!.includes(i.row.id)) : pool.filter((i) => i.row.total_paise > EWAY_LIMIT_PAISE);
  const t = req.transport;
  if (t) {
    if (t.mode === 'road' && !t.vehicleNo.trim() && !t.transporterId.trim()) warnings.push('By road, the e-way bill needs a vehicle number or a transporter id before the goods move. Part B can also be filled in on the portal.');
    if (!Number.isInteger(t.distanceKm) || t.distanceKm < 0 || t.distanceKm > 4000) throw new UserError('Distance is a whole number of kilometres, 0 to 4000. Use 0 to let the portal work it out.');
  }
  const bills = chosen.map((inv) => {
    const r = inv.row;
    const doc = `Invoice ${r.number}`;
    const seller = JSON.parse(r.seller_json) as Party;
    const buyer = JSON.parse(r.buyer_json) as Party;
    if (!isPin(seller.pincode)) warnings.push(`${doc}: your pincode "${seller.pincode}" is not a 6 digit pincode.`);
    if (!isPin(buyer.pincode)) warnings.push(`${doc}: the buyer's pincode "${buyer.pincode}" is not a 6 digit pincode.`);
    const to = posCode(r.place_of_supply, buyer.gstin) ?? sellerCode;
    const toGstin = isValidGstin(buyer.gstin) ? buyer.gstin.trim().toUpperCase() : 'URP';
    const items = inv.lines.map((l, i) => {
      if (!validHsn(l.hsn)) warnings.push(`${doc}: "${l.designName}" has no valid HSN code (4 to 8 digits).`);
      const half = l.ratePercent / 2;
      return {
        itemNo: i + 1,
        productName: clip(l.designName, 100),
        productDesc: clip([l.designName, l.color, l.size].filter(Boolean).join(' '), 100),
        hsnCode: Number(l.hsn) || 0,
        quantity: l.qty,
        qtyUnit: 'PCS',
        taxableAmount: r2(l.taxable),
        sgstRate: r.intra_state === 1 ? half : 0,
        cgstRate: r.intra_state === 1 ? half : 0,
        igstRate: r.intra_state === 1 ? 0 : l.ratePercent,
        cessRate: 0,
      };
    });
    return {
      userGstin: gstin,
      supplyType: 'O',
      subSupplyType: 1,
      subSupplyDesc: '',
      docType: 'INV',
      docNo: r.number,
      docDate: portalDate(r.issue_date, '/'),
      transactionType: 1,
      fromGstin: gstin,
      fromTrdName: seller.name,
      fromAddr1: clip(seller.address || seller.city, 120),
      fromAddr2: '',
      fromPlace: seller.city,
      fromPincode: Number(seller.pincode) || 0,
      fromStateCode: Number(sellerCode),
      actualFromStateCode: Number(sellerCode),
      toGstin,
      toTrdName: buyer.name,
      toAddr1: clip(buyer.address || buyer.city, 120),
      toAddr2: '',
      toPlace: buyer.city,
      toPincode: Number(buyer.pincode) || 0,
      toStateCode: Number(to),
      actualToStateCode: Number(to),
      totalValue: r2(r.taxable_paise),
      cgstValue: r2(r.cgst_paise),
      sgstValue: r2(r.sgst_paise),
      igstValue: r2(r.igst_paise),
      cessValue: 0,
      otherValue: r2(r.round_off_paise),
      totInvValue: r2(r.total_paise),
      ...(t
        ? {
            transMode: String(EWAY_MODE[t.mode]),
            transDistance: String(t.distanceKm),
            transporterName: t.transporterName,
            transporterId: t.transporterId.trim().toUpperCase(),
            transDocNo: t.docNo,
            transDocDate: t.docDate ? portalDate(t.docDate, '/') : '',
            vehicleNo: t.vehicleNo.replace(/\s+/g, '').toUpperCase(),
            vehicleType: 'R',
          }
        : {}),
      itemList: items,
    };
  });
  const summary = [`${bills.length} e-way bills, for invoices above the limit of ₹${(EWAY_LIMIT_PAISE / 100).toLocaleString('en-IN')}${req.invoiceIds?.length ? ' (or the ones you chose)' : ''}.`];
  if (bills.length === 0) warnings.push('No invoice in this range is above the e-way bill limit. Pick the invoices yourself if you are sending smaller consignments.');
  warnings.push('Upload this file on the e-way bill portal (Generate in bulk). InvoiceOn does not connect to the portal.');
  return { filename: `e-way bills ${req.from} to ${req.to}.json`, content: JSON.stringify({ version: '1.0.0621', billLists: bills }, null, 2), count: bills.length, summary, warnings };
}

export function gstFilingExport(db: Db, req: FilingRequest): FilingFile {
  checkRange(req);
  switch (req?.kind) {
    case 'gstr1':
      return gstr1(db, req);
    case 'einvoice':
      return eInvoice(db, req);
    case 'eway':
      return eWay(db, req);
    default:
      throw new UserError('Choose which file to prepare.');
  }
}
