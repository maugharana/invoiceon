import { beforeEach, describe, expect, it } from 'vitest';
import { createApi, type Host } from '../electron/api';
import { openDb, type Db } from '../electron/db/connection';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import { saveSettings } from '../electron/services/settings';
import { todayIso } from '../shared/gst';

const today = todayIso();
let db: Db;
let variantId: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, { gstin: '09AABCK1234M1ZI', invoicePrefix: 'MG' });
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: 100000 });
  variantId = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: 100000, baseCostPaise: 0, reorderLevel: 0, openingStock: 5, bom: [] }).id;
});

const invoice = () => invoices.createInvoice(db, { type: 'B2C', customerId: null, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty: 1, unitPricePaise: 100000 }] });

/** A shell that records what it was asked to do, in place of the real one. */
function fakeHost() {
  const calls: { route: string; fileName: string }[] = [];
  const revealed: string[] = [];
  const host = {
    shareDocument: async (route: string, fileName: string) => {
      calls.push({ route, fileName });
      return { path: `C:/temp/${fileName}`, copied: true };
    },
    revealFile: async (path: string) => {
      revealed.push(path);
    },
  } as unknown as Host;
  return { host, calls, revealed };
}

describe('getting an invoice ready to send', () => {
  it("asks the shell for the invoice's own page, named by its number with nothing a file name can't hold", async () => {
    const { host, calls } = fakeHost();
    const api = createApi(db, host);
    const inv = invoice();
    const file = await api.invoiceShareFile(inv.id);
    expect(calls).toEqual([{ route: `/print/invoice/${inv.id}`, fileName: `Invoice ${inv.number.replace(/\//g, '-')}.pdf` }]);
    expect(file).toEqual({ path: `C:/temp/Invoice ${inv.number.replace(/\//g, '-')}.pdf`, copied: true });
  });

  it('works only in the desktop app, and not for an invoice that was cancelled', async () => {
    const inv = invoice();
    await expect(createApi(db).invoiceShareFile(inv.id)).rejects.toThrow(/desktop app/);
    await expect(createApi(db).shareReveal('C:/x.pdf')).rejects.toThrow(/desktop app/);
    invoices.cancelInvoice(db, inv.id, 'x');
    await expect(createApi(db, fakeHost().host).invoiceShareFile(inv.id)).rejects.toThrow(/cancelled/);
    await expect(createApi(db, fakeHost().host).invoiceShareFile('nope')).rejects.toThrow(/no longer exists/);
  });

  it('can show the made file in its folder', async () => {
    const { host, revealed } = fakeHost();
    await createApi(db, host).shareReveal('C:/temp/Invoice.pdf');
    expect(revealed).toEqual(['C:/temp/Invoice.pdf']);
  });
});
