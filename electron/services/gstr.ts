import { STATES } from '../../shared/states';
import type { Gstr1Export } from '../../shared/types';
import { all, type Db } from '../db/connection';
import { UserError } from './common';
import { checkRange, loadCredits, loadInvoices } from './reports';
import { getSettings } from './settings';

// A GSTR-1 file in the shape the GST portal's "Prepare offline" / offline tool accepts: B2B invoices, B2C small supplies rolled up by
// state and rate, credit notes to registered buyers, the HSN summary and the documents issued. It is built from the same books as the
// GST report, so the two always agree. It is made for you to review and upload yourself; InvoiceOn does not file anything, and the
// portal checks the file when you upload it, so look at the warnings below the button first.

const rupees = (paise: number): number => Math.round(paise) / 100;
const stateCode = (name: string): string => STATES.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())?.code ?? '';
const dmy = (iso: string): string => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

interface Item {
  num: number;
  itm_det: { txval: number; rt: number; iamt: number; camt: number; samt: number; csamt: number };
}
const itemOf = (num: number, g: { ratePercent: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }): Item => ({
  num,
  itm_det: { txval: rupees(g.taxablePaise), rt: g.ratePercent, iamt: rupees(g.igstPaise), camt: rupees(g.cgstPaise), samt: rupees(g.sgstPaise), csamt: 0 },
});

/** The return period is the month the range ends in, written MMYYYY as the portal wants it. */
const periodOf = (to: string): string => `${to.slice(5, 7)}${to.slice(0, 4)}`;

export function gstr1(db: Db, range: { from: string; to: string }): Gstr1Export {
  checkRange(range);
  if (range.from.slice(0, 7) !== range.to.slice(0, 7)) throw new UserError('GSTR-1 is filed for one month at a time. Choose a single month.');
  const settings = getSettings(db);
  const warnings: string[] = [];
  if (!settings.gstin) warnings.push('Your own GSTIN is not set (Settings > Business Profile). The file needs it.');

  const invoices = loadInvoices(db, range);
  const credits = loadCredits(db, range);

  // B2B: registered buyers, invoice by invoice, tax by rate.
  const b2b = new Map<string, { inum: string; idt: string; val: number; pos: string; rchrg: 'N'; inv_typ: 'R'; itms: Item[] }[]>();
  for (const i of invoices.filter((x) => x.row.type === 'B2B')) {
    const ctin = i.buyerGstin.toUpperCase();
    if (!ctin) {
      warnings.push(`${i.row.number} is a B2B invoice but its buyer has no GSTIN.`);
      continue;
    }
    const pos = stateCode(i.row.place_of_supply) || ctin.slice(0, 2);
    const list = b2b.get(ctin) ?? [];
    list.push({ inum: i.row.number, idt: dmy(i.row.issue_date), val: rupees(i.row.total_paise), pos, rchrg: 'N', inv_typ: 'R', itms: i.groups.map((g, n) => itemOf(n + 1, g)) });
    b2b.set(ctin, list);
  }

  // B2C: small supplies are not listed bill by bill, only totalled by whether it stayed in the state, the rate and the state. Credit notes
  // to unregistered buyers come off the same totals.
  const b2cs = new Map<string, { sply_ty: 'INTRA' | 'INTER'; rt: number; typ: 'OE'; pos: string; txval: number; iamt: number; camt: number; samt: number; csamt: number }>();
  const addB2c = (intra: boolean, pos: string, g: { ratePercent: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }, sign: 1 | -1) => {
    const key = `${intra ? 'INTRA' : 'INTER'}|${g.ratePercent}|${pos}`;
    const row = b2cs.get(key) ?? { sply_ty: intra ? ('INTRA' as const) : ('INTER' as const), rt: g.ratePercent, typ: 'OE' as const, pos, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
    row.txval += sign * g.taxablePaise;
    row.iamt += sign * g.igstPaise;
    row.camt += sign * g.cgstPaise;
    row.samt += sign * g.sgstPaise;
    b2cs.set(key, row);
  };
  for (const i of invoices.filter((x) => x.row.type === 'B2C')) {
    const pos = stateCode(i.row.place_of_supply) || stateCode(settings.state);
    if (!pos) warnings.push(`${i.row.number} has no place of supply, so its state could not be worked out.`);
    for (const g of i.groups) addB2c(i.row.intra_state === 1, pos, g, 1);
  }

  const cdnr = new Map<string, { ntty: 'C'; nt_num: string; nt_dt: string; val: number; pos: string; rchrg: 'N'; inv_typ: 'R'; itms: Item[] }[]>();
  for (const c of credits) {
    if (c.type === 'B2C') {
      const pos = stateCode(c.placeOfSupply) || stateCode(settings.state);
      for (const g of c.groups) addB2c(c.intra, pos, g, -1);
      continue;
    }
    const ctin = c.buyerGstin.toUpperCase();
    if (!ctin) {
      warnings.push(`${c.number} is a credit note to a business with no GSTIN.`);
      continue;
    }
    const list = cdnr.get(ctin) ?? [];
    list.push({ ntty: 'C', nt_num: c.number, nt_dt: dmy(c.date), val: rupees(c.total), pos: stateCode(c.placeOfSupply) || ctin.slice(0, 2), rchrg: 'N', inv_typ: 'R', itms: c.groups.map((g, n) => itemOf(n + 1, g)) });
    cdnr.set(ctin, list);
  }

  // HSN summary, net of credit notes (the report already shares the tax over lines to the paisa).
  const hsn = new Map<string, { qty: number; val: number; txval: number; iamt: number; camt: number; samt: number }>();
  const addHsn = (code: string, qty: number, taxable: number, cgst: number, sgst: number, igst: number) => {
    const key = code || '';
    const h = hsn.get(key) ?? { qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0 };
    h.qty += qty;
    h.txval += taxable;
    h.camt += cgst;
    h.samt += sgst;
    h.iamt += igst;
    h.val += taxable + cgst + sgst + igst;
    hsn.set(key, h);
  };
  for (const l of invoices.flatMap((i) => i.lines)) addHsn(l.hsn, l.qty, l.taxable, l.cgst, l.sgst, l.igst);
  for (const l of credits.flatMap((c) => c.lines)) addHsn(l.hsn, -l.qty, -l.taxable, -l.cgst, -l.sgst, -l.igst);
  if (hsn.has('')) warnings.push('Some items have no HSN code. Add the HSN on each design (Inventory), or the portal will reject the summary.');
  for (const code of hsn.keys()) if (code && !/^\d{4,8}$/.test(code)) warnings.push(`HSN “${code}” is not 4 to 8 digits.`);

  // Documents issued: the first and last number, how many, and how many were cancelled.
  const numbers = all<{ number: string; status: string }>(db, 'SELECT number, status FROM invoices WHERE issue_date BETWEEN ? AND ? ORDER BY series, seq', range.from, range.to);
  const noteNumbers = all<{ number: string }>(db, 'SELECT number FROM credit_notes WHERE issue_date BETWEEN ? AND ? ORDER BY seq', range.from, range.to);
  const docs: { doc_num: number; docs: { num: number; from: string; to: string; totnum: number; cancel: number; net_issue: number }[] }[] = [];
  if (numbers.length > 0) {
    const cancelled = numbers.filter((n) => n.status === 'cancelled').length;
    docs.push({ doc_num: 1, docs: [{ num: 1, from: numbers[0]!.number, to: numbers[numbers.length - 1]!.number, totnum: numbers.length, cancel: cancelled, net_issue: numbers.length - cancelled }] });
  }
  if (noteNumbers.length > 0) docs.push({ doc_num: 5, docs: [{ num: 1, from: noteNumbers[0]!.number, to: noteNumbers[noteNumbers.length - 1]!.number, totnum: noteNumbers.length, cancel: 0, net_issue: noteNumbers.length }] });

  const file: Record<string, unknown> = {
    gstin: settings.gstin,
    fp: periodOf(range.to),
    version: 'GST3.0.4',
    hash: 'hash',
    gt: 0,
    cur_gt: 0,
    b2b: [...b2b.entries()].map(([ctin, inv]) => ({ ctin, inv })),
    b2cs: [...b2cs.values()].filter((r) => r.txval !== 0 || r.iamt !== 0 || r.camt !== 0 || r.samt !== 0).map((r) => ({ ...r, txval: rupees(r.txval), iamt: rupees(r.iamt), camt: rupees(r.camt), samt: rupees(r.samt) })),
    cdnr: [...cdnr.entries()].map(([ctin, nt]) => ({ ctin, nt })),
    hsn: {
      data: [...hsn.entries()]
        .filter(([, h]) => h.qty !== 0 || h.txval !== 0)
        .map(([code, h], n) => ({ num: n + 1, hsn_sc: code, desc: '', uqc: 'PCS', qty: h.qty, val: rupees(h.val), txval: rupees(h.txval), iamt: rupees(h.iamt), camt: rupees(h.camt), samt: rupees(h.samt), csamt: 0 })),
    },
    doc_issue: { doc_det: docs },
  };
  for (const key of ['b2b', 'b2cs', 'cdnr'] as const) if ((file[key] as unknown[]).length === 0) delete file[key];
  if (docs.length === 0) delete file.doc_issue;
  if ((file.hsn as { data: unknown[] }).data.length === 0) delete file.hsn;

  return {
    fileName: `GSTR1_${settings.gstin || 'GSTIN'}_${periodOf(range.to)}.json`,
    json: JSON.stringify(file, null, 2),
    counts: { b2bInvoices: [...b2b.values()].reduce((s, l) => s + l.length, 0), b2cLines: [...b2cs.values()].length, creditNotes: credits.length, hsnLines: hsn.size },
    warnings: [...new Set(warnings)],
  };
}
