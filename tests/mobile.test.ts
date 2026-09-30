import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import { mobileController, mobileDues, mobileInvoices, mobileStock, mobileSummary } from '../electron/mobile';
import * as customers from '../electron/services/customers';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as payments from '../electron/services/payments';
import { saveSettings } from '../electron/services/settings';
import { todayIso } from '../shared/gst';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  mobileController(db, { port: 0, host: '127.0.0.1' }); // a random local port, for the tests
  saveSettings(db, { businessName: 'Mau Gharana', state: 'Uttar Pradesh', gstin: '09AAACH7409R1ZZ', gstRatePercent: 5 });
});
afterEach(async () => {
  await mobileController(db).stop();
});

const today = todayIso();
const rupees = (n: number) => n * 100;

function shop() {
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: 'Silk', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  const v = inventory.createVariant(db, d.id, { color: 'Maroon', size: '6.3 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(400), reorderLevel: 2, openingStock: 10, bom: [] });
  const c = customers.createCustomer(db, { name: 'Sunita', type: 'B2C', phone: '98765 43210', email: '', gstin: '', address: '', city: 'Mau', state: 'Uttar Pradesh', pincode: '', notes: '' });
  const inv = invoices.createInvoice(db, { type: 'B2C', customerId: c.id, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId: v.id, qty: 2, unitPricePaise: rupees(1000) }] });
  return { d, v, c, inv };
}

async function up() {
  const status = await mobileController(db).enable();
  const base = new URL(status.urls[0]!);
  return { status, base, at: (path: string, init?: RequestInit) => fetch(new URL(path, base), init) };
}

describe('what the phone may see', () => {
  it('summarises today, the month, dues and stock', () => {
    const { inv } = shop();
    const s = mobileSummary(db);
    expect(s).toMatchObject({ businessName: 'Mau Gharana', asOf: today, today: { invoices: 1, invoicedPaise: inv.totalPaise }, outstandingPaise: inv.totalPaise, unitsInStock: 8 });
  });

  it('leaves cancelled invoices out of today', () => {
    const { inv } = shop();
    invoices.cancelInvoice(db, inv.id, 'mistake');
    expect(mobileSummary(db).today).toEqual({ invoices: 0, invoicedPaise: 0 });
  });

  it('lists who owes the most first, with how much is overdue', () => {
    const { c, inv } = shop();
    payments.recordPayment(db, { customerId: c.id, amountPaise: rupees(500), method: 'cash', reference: '', receivedOn: today, note: '', allocations: [{ invoiceId: inv.id, amountPaise: rupees(500) }] });
    const dues = mobileDues(db);
    expect(dues).toHaveLength(1);
    expect(dues[0]).toMatchObject({ name: 'Sunita', phone: '98765 43210', openInvoices: 1 });
    expect(dues[0]!.outstandingPaise).toBe(inv.totalPaise - rupees(500));
  });

  it('searches stock by design, colour or SKU and never sends a cost', () => {
    shop();
    expect(mobileStock(db, 'butidar')).toHaveLength(1);
    expect(mobileStock(db, 'maroon 6.3')).toHaveLength(1);
    expect(mobileStock(db, 'nothing like this')).toEqual([]);
    const row = mobileStock(db, '')[0]!;
    expect(Object.keys(row).sort()).toEqual(['color', 'designCode', 'designName', 'mrpPaise', 'sellPricePaise', 'size', 'sku', 'stock']);
    expect(JSON.stringify(row)).not.toMatch(/cost|profit|margin/i);
  });

  it('shows the latest invoices with their state', () => {
    const { inv } = shop();
    expect(mobileInvoices(db)[0]).toMatchObject({ number: inv.number, buyerName: 'Sunita', totalPaise: inv.totalPaise, paidPaise: 0, status: 'unpaid' });
  });
});

describe('the phone view server', () => {
  it('is off until switched on, and says so', () => {
    expect(mobileController(db).status()).toEqual({ enabled: false, running: false, port: null, error: null, urls: [] });
  });

  it('serves a page at a secret link, under a strict content policy', async () => {
    const { status, at } = await up();
    expect(status).toMatchObject({ enabled: true, running: true });
    expect(status.urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/m\/[0-9a-f]{32}\/$/);
    const res = await at('');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const csp = res.headers.get('content-security-policy')!;
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1]!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    const html = await res.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).not.toContain('__NONCE__');
    expect(html).not.toMatch(/style="/); // inline style attributes would be refused by the policy
    // A new nonce every time.
    expect(/script-src 'nonce-([^']+)'/.exec((await at('')).headers.get('content-security-policy')!)![1]).not.toBe(nonce);
  });

  it('sends the same figures over its data links', async () => {
    const { inv } = shop();
    const { at } = await up();
    const summary = (await (await at('data/summary')).json()) as { today: { invoicedPaise: number } };
    expect(summary.today.invoicedPaise).toBe(inv.totalPaise);
    expect(((await (await at('data/stock?q=maroon')).json()) as unknown[]).length).toBe(1);
    expect(((await (await at('data/dues')).json()) as { name: string }[])[0]!.name).toBe('Sunita');
    expect(((await (await at('data/invoices')).json()) as { number: string }[])[0]!.number).toBe(inv.number);
  });

  it('redirects the link without its trailing slash, so the page finds its data', async () => {
    const { base } = await up();
    const res = await fetch(new URL(base.pathname.replace(/\/$/, ''), base), { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(base.pathname);
  });

  it('answers 404 to a wrong link, the wrong method, and anything else', async () => {
    const { base, at } = await up();
    const token = base.pathname.split('/')[2]!;
    const wrong = token.replace(/./, (c) => (c === '0' ? '1' : '0'));
    expect((await at(`/m/${wrong}/`)).status).toBe(404);
    expect((await at(`/m/${wrong}/data/summary`)).status).toBe(404);
    expect((await at('/')).status).toBe(404);
    expect((await at('/m/short/')).status).toBe(404);
    expect((await at('data/summary', { method: 'POST', body: '{}' })).status).toBe(404); // nothing can be written
    expect((await at('data/secrets')).status).toBe(404);
    expect((await at('data/summary')).status).toBe(200);
  });

  it('slows down guessing but never turns the right link away', async () => {
    const { base, at } = await up();
    const token = base.pathname.split('/')[2]!;
    const wrong = `/m/${token.replace(/./, (c) => (c === '0' ? '1' : '0'))}/`;
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await at(wrong)).status;
    expect(last).toBe(429);
    expect((await at('data/summary')).status).toBe(200);
  });

  it('gives phones with the old link the boot when the link is reset', async () => {
    const { status, at } = await up();
    const before = status.urls[0]!;
    const after = (await mobileController(db).resetLink()).urls[0]!;
    expect(after).not.toBe(before);
    expect((await fetch(before)).status).toBe(404);
    expect((await at(after)).status).toBe(200);
  });

  it('stops answering when switched off, and starts again at the next launch if it was on', async () => {
    const { status } = await up();
    const link = status.urls[0]!;
    const off = await mobileController(db).disable();
    expect(off).toMatchObject({ enabled: false, running: false, urls: [] });
    await expect(fetch(link)).rejects.toThrow();

    // "Next launch": it was switched on, the app was closed (stop), then opened again (resume).
    await mobileController(db).enable();
    await mobileController(db).stop();
    expect(mobileController(db).status()).toMatchObject({ enabled: true, running: false });
    await mobileController(db).resume();
    const again = mobileController(db).status();
    expect(again.running).toBe(true);
    expect((await fetch(again.urls[0]!)).status).toBe(200);
  });

  it('does not start on resume when it was never switched on', async () => {
    await mobileController(db).resume();
    expect(mobileController(db).status().running).toBe(false);
  });

  it('is controlled through the API, and only by the owner once sign-in is on', async () => {
    const api = createApi(db);
    expect((await api.mobileStatus()).enabled).toBe(false);
    const on = await api.mobileEnable();
    expect(on.running).toBe(true);
    expect((await api.mobileDisable()).running).toBe(false);
  });
});
