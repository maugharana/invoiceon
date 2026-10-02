import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../electron/db/connection';
import * as accounts from '../electron/services/accounts';
import * as customers from '../electron/services/customers';
import { dashboardOverview } from '../electron/services/dashboard';
import * as expenses from '../electron/services/expenses';
import * as instalments from '../electron/services/instalments';
import * as inventory from '../electron/services/inventory';
import * as invoices from '../electron/services/invoices';
import * as moreReports from '../electron/services/moreReports';
import * as notes from '../electron/services/notes';
import * as payments from '../electron/services/payments';
import * as receivables from '../electron/services/receivables';
import * as reports from '../electron/services/reports';
import { getSettings, saveSettings } from '../electron/services/settings';
import { addDays, todayIso } from '../shared/gst';
import { matchStatement, parseStatement } from '../shared/reconcile';
import { nextOccurrenceOf } from '../shared/recurring';
import type { ExpenseInput } from '../shared/types';

const rupees = (n: number) => n * 100;
const today = todayIso();
let db: Db;
let variantId: string;
let customerId: string;

beforeEach(() => {
  db = openDb(':memory:');
  saveSettings(db, {
    gstin: '09AABCK1234M1ZI',
    paymentAccounts: [
      { id: 'cash', name: 'Cash drawer', kind: 'cash', details: '', openingPaise: rupees(500) },
      { id: 'bank', name: 'SBI', kind: 'bank', details: '', openingPaise: rupees(10000) },
    ],
  });
  const d = inventory.createDesign(db, { code: 'MG-001', name: 'Butidar', fabric: '', hsnCode: '5007', description: '', defaultPricePaise: rupees(1000) });
  variantId = inventory.createVariant(db, d.id, { color: 'Red', size: '6 m', sellPricePaise: rupees(1000), baseCostPaise: rupees(400), reorderLevel: 0, openingStock: 50, bom: [] }).id;
  customerId = customers.createCustomer(db, { name: 'Meena', type: 'B2C', phone: '', email: '', gstin: '', address: '', city: '', state: '', pincode: '', notes: '' }).id;
});

const invoice = (qty = 1, over: Partial<Parameters<typeof invoices.createInvoice>[1]> = {}) =>
  invoices.createInvoice(db, { type: 'B2C', customerId, issueDate: today, dueDate: today, discountPaise: 0, notes: '', lines: [{ variantId, qty, unitPricePaise: rupees(1000) }], ...over });
const pay = (amount: number, over: Partial<Parameters<typeof payments.recordPayment>[1]> = {}) =>
  payments.recordPayment(db, { customerId, amountPaise: amount, method: 'bank', reference: '', receivedOn: today, note: '', allocations: [], ...over });
const spend = (over: Partial<ExpenseInput> = {}) =>
  expenses.createExpense(db, { date: today, category: 'Rent', vendor: '', amountPaise: rupees(1000), method: 'cash', reference: '', note: '', ...over });

describe('standing expense dates', () => {
  it('moves weekly, monthly, quarterly and yearly, and keeps to the day the series started on', () => {
    expect(nextOccurrenceOf('2026-10-02', 'weekly')).toBe('2026-10-09');
    expect(nextOccurrenceOf('2026-10-02', 'monthly')).toBe('2026-11-02');
    expect(nextOccurrenceOf('2026-11-30', 'quarterly')).toBe('2027-02-28');
    expect(nextOccurrenceOf('2027-02-28', 'quarterly', '2026-11-30')).toBe('2027-05-30');
    expect(nextOccurrenceOf('2026-12-15', 'monthly')).toBe('2027-01-15');
    expect(nextOccurrenceOf('2028-02-29', 'yearly')).toBe('2029-02-28');
    // The 31st becomes the end of a short month and goes back to the 31st afterwards.
    expect(nextOccurrenceOf('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextOccurrenceOf('2026-02-28', 'monthly', '2026-01-31')).toBe('2026-03-31');
  });
});

describe('reading a bank statement', () => {
  const text = [
    'Date,Narration,Debit,Credit,Balance',
    '02/10/2026,UPI/4471882/Meena,,"5,000.00",9000',
    '03/10/2026,ATM WDL,"2,000.00",,7000',
    '05/10/2026,NEFT KANCHAN,,"20,000.00",27000',
    'not a date,x,,100,0',
  ].join('\n');

  it('keeps money-in lines, skips withdrawals, and says which rows it could not read', () => {
    const r = parseStatement(text);
    expect(r.lines.map((l) => [l.row, l.date, l.creditPaise])).toEqual([[2, '2026-10-02', rupees(5000)], [4, '2026-10-05', rupees(20000)]]);
    expect(r.skippedDebits).toBe(1);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ row: 5 });
  });

  it('copes with one signed amount column, and refuses a sheet with no usable headings', () => {
    const r = parseStatement('Date,Particulars,Amount\n01/10/2026,Deposit,1500\n02/10/2026,Charges,-20');
    expect(r.lines.map((l) => l.creditPaise)).toEqual([rupees(1500)]);
    expect(r.skippedDebits).toBe(1);
    expect(parseStatement('hello\nworld').problems[0]!.message).toMatch(/headings/);
  });

  it('pairs a line with the payment of the same amount, preferring the one whose reference is on the line', () => {
    const lines = parseStatement(text).lines;
    const result = matchStatement(
      lines,
      [
        { id: 'a', amountPaise: rupees(5000), receivedOn: '2026-10-02', reference: '', chequeDate: null },
        { id: 'b', amountPaise: rupees(5000), receivedOn: '2026-10-02', reference: 'UPI 4471882', chequeDate: null },
        { id: 'c', amountPaise: rupees(20000), receivedOn: '2026-09-01', reference: '', chequeDate: null }, // far too early
      ],
    );
    expect(result.matches).toEqual([{ row: 2, paymentId: 'b', reason: 'reference' }]);
    expect(result.unmatchedRows).toEqual([4]);
    expect(result.unmatchedPaymentIds.sort()).toEqual(['a', 'c']);
  });

  it('uses each payment only once, and allows a post-dated cheque to land near its written date', () => {
    const lines = [
      { row: 2, date: '2026-10-10', description: '', creditPaise: 100 },
      { row: 3, date: '2026-10-10', description: '', creditPaise: 100 },
    ];
    const r = matchStatement(lines, [{ id: 'p', amountPaise: 100, receivedOn: '2026-09-01', reference: '', chequeDate: '2026-10-09' }]);
    expect(r.matches).toEqual([{ row: 2, paymentId: 'p', reason: 'date' }]);
    expect(r.unmatchedRows).toEqual([3]);
  });
});

describe('payment accounts', () => {
  it('keeps an opening balance and budgets with the settings, and tidies the budgets', () => {
    expect(getSettings(db).paymentAccounts[0]!.openingPaise).toBe(rupees(500));
    expect(saveSettings(db, { expenseBudgets: { Rent: rupees(20000), Tea: 0 } }).expenseBudgets).toEqual({ Rent: rupees(20000) });
    expect(() => saveSettings(db, { expenseBudgets: { Rent: -1 } })).toThrow(/whole number|can't be less/);
  });

  it('records which account a payment or bill used, and refuses one that is not in Settings', () => {
    expect(pay(rupees(100), { accountId: 'bank' }).accountId).toBe('bank');
    expect(() => pay(rupees(100), { accountId: 'nope' })).toThrow(/Choose the account/);
    expect(spend({ accountId: 'cash' }).accountId).toBe('cash');
    expect(() => spend({ accountId: 'nope' })).toThrow(/Choose the account/);
  });

  it('works out each balance from the opening figure, receipts, bills paid and transfers', () => {
    pay(rupees(2000), { accountId: 'bank' });
    pay(rupees(300), { accountId: 'cash', method: 'cash' });
    spend({ amountPaise: rupees(100), accountId: 'cash' });
    spend({ amountPaise: rupees(40), accountId: '' }); // not linked
    accounts.createTransfer(db, { fromAccountId: 'cash', toAccountId: 'bank', amountPaise: rupees(200), date: today, note: 'Deposit' });
    // A bill not paid yet is not money out.
    spend({ amountPaise: rupees(9999), status: 'unpaid', dueDate: addDays(today, 5), accountId: 'bank' });

    const book = accounts.accountBook(db, { from: addDays(today, -30), to: today });
    const byId = (id: string) => book.accounts.find((a) => a.accountId === id)!;
    expect(byId('cash')).toMatchObject({ openingPaise: rupees(500), closingPaise: rupees(500 + 300 - 100 - 200) });
    expect(byId('bank')).toMatchObject({ openingPaise: rupees(10000), closingPaise: rupees(10000 + 2000 + 200) });
    expect(byId('')).toMatchObject({ name: 'Not linked to an account', closingPaise: -rupees(40) });
    expect(byId('cash').entries.map((e) => e.kind)).toEqual(['receipt', 'expense', 'transfer-out']);
    expect(book.totalClosingPaise).toBe(rupees(500 + 300 - 100 - 200 + 10000 + 2000 + 200 - 40));
  });

  it('folds earlier movements into the opening figure of a later period', () => {
    pay(rupees(1000), { accountId: 'bank', receivedOn: addDays(today, -10) });
    const book = accounts.accountBook(db, { from: addDays(today, -5), to: today });
    expect(book.accounts.find((a) => a.accountId === 'bank')).toMatchObject({ openingPaise: rupees(11000), inPaise: 0, entries: [] });
  });

  it('refuses a transfer to the same account, to an unknown one, in the future, or for nothing', () => {
    const base = { fromAccountId: 'cash', toAccountId: 'bank', amountPaise: 100, date: today, note: '' };
    expect(() => accounts.createTransfer(db, { ...base, toAccountId: 'cash' })).toThrow(/different/);
    expect(() => accounts.createTransfer(db, { ...base, toAccountId: 'x' })).toThrow(/Choose both/);
    expect(() => accounts.createTransfer(db, { ...base, date: addDays(today, 1) })).toThrow(/future/);
    expect(() => accounts.createTransfer(db, { ...base, amountPaise: 0 })).toThrow();
    const t = accounts.createTransfer(db, base);
    accounts.deleteTransfer(db, t.id);
    expect(accounts.listTransfers(db)).toEqual([]);
    expect(() => accounts.deleteTransfer(db, t.id)).toThrow(/no longer exists/);
  });
});

describe('closing the day', () => {
  it('expects the cash accounts plus unlinked cash, counts, and stores the difference', () => {
    pay(rupees(300), { accountId: 'cash', method: 'cash' });
    pay(rupees(50), { method: 'cash' }); // unlinked but cash
    pay(rupees(900), { method: 'bank' }); // not cash
    spend({ amountPaise: rupees(100), accountId: 'cash' });
    const open = accounts.dayClose(db, today);
    expect(open).toMatchObject({ expectedPaise: rupees(500 + 300 + 50 - 100), countedPaise: null, differencePaise: null });
    const closed = accounts.closeDay(db, today, rupees(740), 'Short by ten');
    expect(closed).toMatchObject({ expectedPaise: rupees(750), countedPaise: rupees(740), differencePaise: -rupees(10), note: 'Short by ten' });
    // Closing again replaces the count.
    expect(accounts.closeDay(db, today, rupees(750), '').differencePaise).toBe(0);
    expect(accounts.listCloses(db)).toHaveLength(1);
    expect(() => accounts.closeDay(db, addDays(today, 1), 0, '')).toThrow(/earlier day/);
  });
});

describe('write-offs', () => {
  it('clear the balance but never count as received or become an advance', () => {
    const inv = invoice(1); // ₹1,050
    pay(rupees(1000), { allocations: [{ invoiceId: inv.id, amountPaise: rupees(1000) }] });
    const w = payments.writeOffBalance(db, { invoiceId: inv.id, amountPaise: rupees(50), reason: 'Rounding' });
    expect(w).toMatchObject({ kind: 'writeoff', amountPaise: rupees(50), method: 'other' });
    expect(invoices.getInvoice(db, inv.id)).toMatchObject({ status: 'paid', paidPaise: rupees(1050) });

    const c = customers.getCustomer(db, customerId);
    expect(c.outstandingPaise).toBe(0);
    expect(c.advancePaise).toBe(0);
    const ledger = receivables.customerLedger(db, customerId);
    expect(ledger).toMatchObject({ receivedPaise: rupees(1000), writtenOffPaise: rupees(50), balancePaise: 0 });
    expect(ledger.entries.some((e) => e.kind === 'writeoff')).toBe(true);

    // Not money in anywhere.
    const range = { from: addDays(today, -1), to: today };
    expect(reports.salesReport(db, range).collectedPaise).toBe(rupees(1000));
    expect(moreReports.dayBook(db, range, 'all').inPaise).toBe(rupees(1000));
    expect(receivables.paymentsSummary(db).receivedThisMonthPaise).toBe(rupees(1000));
    expect(dashboardOverview(db, { from: addDays(today, -1), to: today }).receivedPaise).toBe(rupees(1000));
    // The ₹1,000 receipt has no account, so it sits under "not linked"; the ₹50 write-off is not money and is not in any account.
    expect(accounts.accountBook(db, range).totalClosingPaise).toBe(rupees(500 + 10000 + 1000));
  });

  it('cannot be more than is owed, and is cancelled (not turned into advance) with its invoice', () => {
    const inv = invoice(1);
    expect(() => payments.writeOffBalance(db, { invoiceId: inv.id, amountPaise: rupees(2000) })).toThrow(/left to pay/);
    payments.writeOffBalance(db, { invoiceId: inv.id, amountPaise: rupees(50) });
    invoices.cancelInvoice(db, inv.id, '');
    expect(customers.getCustomer(db, customerId).advancePaise).toBe(0);
    expect(payments.listPayments(db, { status: 'writeoff' })[0]!.voided).toBe(true);
  });

  it('can be reversed, which puts the balance back', () => {
    const inv = invoice(1);
    const w = payments.writeOffBalance(db, { invoiceId: inv.id, amountPaise: rupees(1050) });
    expect(invoices.getInvoice(db, inv.id).status).toBe('paid');
    payments.voidPayment(db, w.id, 'changed my mind');
    expect(invoices.getInvoice(db, inv.id)).toMatchObject({ paidPaise: 0 });
    expect(customers.getCustomer(db, customerId).outstandingPaise).toBe(rupees(1050));
  });

  it('works for a walk-in invoice too', () => {
    const inv = invoice(1, { customerId: null, buyerName: 'Walk-in' });
    payments.writeOffBalance(db, { invoiceId: inv.id, amountPaise: rupees(10) });
    expect(invoices.getInvoice(db, inv.id).paidPaise).toBe(rupees(10));
  });
});

describe('cheques', () => {
  const cheque = (chequeDate: string | null) => pay(rupees(500), { method: 'cheque', reference: 'CHQ 000123', chequeDate });

  it('track a post-dated cheque from waiting to cleared, and only a cheque can have a date', () => {
    const p = cheque(addDays(today, 10));
    expect(p).toMatchObject({ chequeStatus: 'pending', chequeDate: addDays(today, 10) });
    expect(payments.setChequeStatus(db, p.id, 'deposited').chequeStatus).toBe('deposited');
    expect(payments.setChequeStatus(db, p.id, 'cleared').chequeStatus).toBe('cleared');
    expect(() => payments.setChequeStatus(db, p.id, 'deposited')).toThrow(/can't be marked/);
    expect(() => pay(rupees(10), { method: 'cash', chequeDate: today })).toThrow(/only goes with a cheque/);
    expect(cheque(null).chequeStatus).toBeNull();
  });

  it('count as received when recorded, and a bounce reverses them so the invoice is owed again', () => {
    const inv = invoice(1);
    const p = pay(rupees(1050), { method: 'cheque', chequeDate: addDays(today, 3), allocations: [{ invoiceId: inv.id, amountPaise: rupees(1050) }] });
    expect(invoices.getInvoice(db, inv.id).status).toBe('paid');
    const bounced = payments.setChequeStatus(db, p.id, 'bounced', 'Insufficient funds');
    expect(bounced).toMatchObject({ voided: true, chequeStatus: 'bounced' });
    expect(bounced.voidReason).toMatch(/Cheque bounced — Insufficient funds/);
    expect(invoices.getInvoice(db, inv.id).paidPaise).toBe(0);
  });

  it('can be listed on their own, and a payment that is not a cheque cannot be moved along', () => {
    cheque(addDays(today, 1));
    const plain = pay(rupees(10));
    expect(payments.listPayments(db, { status: 'cheque' })).toHaveLength(1);
    expect(() => payments.setChequeStatus(db, plain.id, 'cleared')).toThrow(/not a tracked cheque/);
  });
});

describe('ticking payments off against the bank', () => {
  it('lists bank-type receipts not yet matched, ticks them, and clears the tick', () => {
    const bank = pay(rupees(100), { accountId: 'bank' });
    pay(rupees(50), { method: 'cash' });
    expect(payments.listPayments(db, { status: 'unreconciled' }).map((p) => p.id)).toEqual([bank.id]);
    expect(payments.setReconciled(db, [bank.id], today)).toBe(1);
    expect(payments.listPayments(db, { status: 'unreconciled' })).toEqual([]);
    expect(payments.getPayment(db, bank.id).reconciledOn).toBe(today);
    payments.setReconciled(db, [bank.id], null);
    expect(payments.getPayment(db, bank.id).reconciledOn).toBeNull();
  });

  it('refuses cash, reversed payments and write-offs', () => {
    const cash = pay(rupees(50), { method: 'cash' });
    expect(() => payments.setReconciled(db, [cash.id], today)).toThrow(/Only bank/);
    const reversed = pay(rupees(60));
    payments.voidPayment(db, reversed.id, '');
    expect(() => payments.setReconciled(db, [reversed.id], today)).toThrow(/reversed/);
    expect(() => payments.setReconciled(db, [], today)).toThrow();
    expect(() => payments.setReconciled(db, [cash.id], addDays(today, 1))).toThrow(/future/);
  });

  it('previews matches from a pasted statement without changing anything', () => {
    const p = pay(rupees(5000), { reference: 'UPI 4471882', accountId: 'bank' });
    const preview = accounts.reconcilePreview(db, 'Date,Narration,Credit\n' + `${today.slice(8)}/${today.slice(5, 7)}/${today.slice(0, 4)},UPI/4471882/Meena,"5,000.00"\n01/01/2020,Mystery,77`);
    expect(preview.proposals[0]).toMatchObject({ paymentId: p.id, reason: 'reference', customerName: 'Meena' });
    expect(preview.proposals[1]).toMatchObject({ paymentId: null });
    expect(payments.getPayment(db, p.id).reconciledOn).toBeNull();
  });
});

describe('instalment plans', () => {
  it('splits an invoice over dates, fills them from the payments made, and shows what is overdue', () => {
    const inv = invoice(2, { issueDate: addDays(today, -40), dueDate: addDays(today, -40) }); // ₹2,100
    const plan = instalments.setInstalments(db, inv.id, [
      { dueDate: addDays(today, -20), amountPaise: rupees(700) },
      { dueDate: addDays(today, -5), amountPaise: rupees(700) },
      { dueDate: addDays(today, 10), amountPaise: rupees(700) },
    ]);
    expect(plan.map((p) => p.status)).toEqual(['overdue', 'overdue', 'upcoming']);
    pay(rupees(1000), { allocations: [{ invoiceId: inv.id, amountPaise: rupees(1000) }] });
    const after = instalments.listInstalments(db, inv.id);
    expect(after.map((p) => [p.status, p.paidPaise])).toEqual([['paid', rupees(700)], ['overdue', rupees(300)], ['upcoming', 0]]);
    expect(instalments.dueInstalments(db, today).map((d) => [d.invoiceNumber, d.position])).toEqual([[inv.number, 1]]);
    expect(instalments.dueInstalments(db, addDays(today, 10))).toHaveLength(2);
  });

  it('must add up to the invoice, in date order, and not start before it', () => {
    const inv = invoice(1);
    const at = (n: number, amount: number) => ({ dueDate: addDays(today, n), amountPaise: amount });
    expect(() => instalments.setInstalments(db, inv.id, [at(5, rupees(500))])).toThrow(/need to match/);
    expect(() => instalments.setInstalments(db, inv.id, [at(9, rupees(500)), at(3, rupees(550))])).toThrow(/date order/);
    expect(() => instalments.setInstalments(db, inv.id, [at(-5, rupees(1050))])).toThrow(/before the invoice date/);
    expect(() => instalments.setInstalments(db, inv.id, [])).toThrow(/at least one/);
  });

  it('can be replaced or removed, and a cancelled invoice drops out of the reminders', () => {
    const inv = invoice(1);
    instalments.setInstalments(db, inv.id, [{ dueDate: today, amountPaise: rupees(1050) }]);
    instalments.setInstalments(db, inv.id, [{ dueDate: today, amountPaise: rupees(500) }, { dueDate: addDays(today, 5), amountPaise: rupees(550) }]);
    expect(instalments.listInstalments(db, inv.id)).toHaveLength(2);
    invoices.cancelInvoice(db, inv.id, '');
    expect(instalments.dueInstalments(db, addDays(today, 30))).toEqual([]);
    instalments.clearInstalments(db, inv.id);
    expect(instalments.listInstalments(db, inv.id)).toEqual([]);
  });
});

describe('promises to pay on the dues list', () => {
  it('show the earliest promised day and the total promised against each customer', () => {
    const inv = invoice(1, { issueDate: addDays(today, -20), dueDate: addDays(today, -5) });
    notes.addNote(db, { subjectType: 'customer', subjectId: customerId, kind: 'promise', body: '', dueDate: addDays(today, 4), amountPaise: rupees(300) });
    notes.addNote(db, { subjectType: 'invoice', subjectId: inv.id, kind: 'promise', body: '', dueDate: addDays(today, 2), amountPaise: rupees(200) });
    const row = receivables.duesReport(db).rows[0]!;
    expect(row).toMatchObject({ promisedOn: addDays(today, 2), promisedPaise: rupees(500) });
  });
});

describe('vendors', () => {
  it('build themselves from the names typed on expenses, ignoring case', () => {
    spend({ vendor: 'Sharma Traders', amountPaise: rupees(100) });
    spend({ vendor: 'sharma traders', amountPaise: rupees(50) });
    spend({ vendor: 'Gupta & Sons', amountPaise: rupees(10), status: 'unpaid', dueDate: today });
    const list = expenses.listVendors(db);
    expect(list.map((v) => [v.name, v.spendPaise, v.expenseCount, v.unpaidPaise])).toEqual([
      ['Sharma Traders', rupees(150), 2, 0],
      ['Gupta & Sons', rupees(10), 1, rupees(10)],
    ]);
    expect(expenses.listExpenses(db, { vendorId: list[0]!.id })).toHaveLength(2);
  });

  it('can be edited, which renames them on their expenses, but not archived while a bill is unpaid', () => {
    const e = spend({ vendor: 'Sharma Traders', status: 'unpaid', dueDate: today });
    const v = expenses.listVendors(db)[0]!;
    const renamed = expenses.updateVendor(db, v.id, { name: 'Sharma & Co', phone: '9876500000', gstin: '09aaach7409r1zz', address: '', notes: '' });
    expect(renamed.gstin).toBe('09AAACH7409R1ZZ');
    expect(expenses.getExpense(db, e.id).vendor).toBe('Sharma & Co');
    expect(() => expenses.archiveVendor(db, v.id)).toThrow(/still owe/);
    expenses.markExpensePaid(db, e.id, { paidOn: today, method: 'cash' });
    expenses.archiveVendor(db, v.id);
    expect(expenses.listVendors(db)).toEqual([]);
  });

  it('refuse a duplicate name or a bad GSTIN', () => {
    expenses.createVendor(db, { name: 'Sharma', phone: '', gstin: '', address: '', notes: '' });
    expect(() => expenses.createVendor(db, { name: 'SHARMA', phone: '', gstin: '', address: '', notes: '' })).toThrow(/already have a vendor/);
    expect(() => expenses.createVendor(db, { name: 'X', phone: '', gstin: '123', address: '', notes: '' })).toThrow(/GSTIN/);
  });
});

describe('input GST and bills owed', () => {
  it('keeps the GST within the amount, and takes it off in profit and loss', () => {
    expect(() => spend({ amountPaise: rupees(100), gstPaise: rupees(101) })).toThrow(/can't be more/);
    spend({ amountPaise: rupees(1050), gstPaise: rupees(50), category: 'Packaging' });
    const pl = moreReports.profitAndLoss(db, { from: addDays(today, -1), to: today });
    expect(pl.expensesPaise).toBe(rupees(1000)); // before the GST that is claimed back
    expect(expenses.expensesOverview(db).totalPaise).toBe(rupees(1050)); // but the list shows what was spent
  });

  it('nets output against input GST', () => {
    invoice(10); // ₹10,000 + 5% = ₹500 output
    spend({ amountPaise: rupees(1050), gstPaise: rupees(50) });
    expect(expenses.gstNet(db, { from: today, to: today })).toEqual({ range: { from: today, to: today }, outputPaise: rupees(500), inputPaise: rupees(50), netPaise: rupees(450) });
    expect(expenses.gstNet(db, { from: addDays(today, -30), to: addDays(today, -20) }).netPaise).toBe(0);
  });

  it('lists purchases with their GST by entry, vendor and month', () => {
    expenses.updateVendor(db, expenses.createVendor(db, { name: 'Sharma', phone: '', gstin: '', address: '', notes: '' }).id, { name: 'Sharma', phone: '', gstin: '09AAACH7409R1ZZ', address: '', notes: '' });
    spend({ vendor: 'Sharma', amountPaise: rupees(1050), gstPaise: rupees(50) });
    spend({ vendor: 'Sharma', amountPaise: rupees(2100), gstPaise: rupees(100) });
    spend({ vendor: 'Local', amountPaise: rupees(300) });
    const r = expenses.purchasesReport(db, { from: addDays(today, -1), to: today });
    expect(r).toMatchObject({ totalPaise: rupees(3150), gstPaise: rupees(150), taxablePaise: rupees(3000), withoutGstPaise: rupees(300) });
    expect(r.byVendor).toEqual([{ vendor: 'Sharma', gstin: '09AAACH7409R1ZZ', totalPaise: rupees(3150), gstPaise: rupees(150) }]);
    expect(r.entries).toHaveLength(2);
    expect(r.byMonth).toHaveLength(1);
  });

  it('an unpaid bill is spending in profit and loss but not money out until it is paid', () => {
    const e = spend({ amountPaise: rupees(700), status: 'unpaid', dueDate: addDays(today, -2), accountId: 'bank' });
    const range = { from: addDays(today, -1), to: today };
    expect(moreReports.profitAndLoss(db, range).expensesPaise).toBe(rupees(700));
    expect(moreReports.dayBook(db, range, 'all').outPaise).toBe(0);
    expect(expenses.payablesSummary(db)).toEqual({ unpaidPaise: rupees(700), unpaidCount: 1, overduePaise: rupees(700), overdueCount: 1 });

    const paid = expenses.markExpensePaid(db, e.id, { paidOn: today, method: 'bank', accountId: 'bank' });
    expect(paid).toMatchObject({ status: 'paid', paidOn: today, dueDate: null });
    expect(moreReports.dayBook(db, range, 'all').outPaise).toBe(rupees(700));
    expect(expenses.payablesSummary(db).unpaidCount).toBe(0);
    expect(() => expenses.markExpensePaid(db, e.id, { paidOn: today, method: 'bank' })).toThrow(/already marked paid/);
  });

  it('is paid on the day it says, which can be earlier than it was entered', () => {
    const e = spend({ date: addDays(today, -10), paidOn: addDays(today, -3) });
    expect(e.paidOn).toBe(addDays(today, -3));
    expect(() => spend({ paidOn: addDays(today, 2) })).toThrow(/future/);
    // An unpaid bill carries no paid day, and a paid one no due day.
    expect(spend({ status: 'unpaid', dueDate: today, paidOn: today }).paidOn).toBeNull();
    expect(spend({ dueDate: today }).dueDate).toBeNull();
  });
});

describe('standing expenses', () => {
  const rent = { category: 'Rent', vendor: 'Landlord', amountPaise: rupees(15000), method: 'bank' as const, note: '', frequency: 'monthly' as const };

  it('list what has come due, and enter it all once, catching up on missed months', () => {
    const r = expenses.createRecurring(db, { ...rent, nextDate: '2026-07-31' });
    const due = expenses.dueRecurring(db, '2026-10-02');
    expect(due[0]!.dates).toEqual(['2026-07-31', '2026-08-31', '2026-09-30']);
    expect(expenses.runRecurring(db, '2026-10-02')).toBe(3);
    expect(expenses.listRecurring(db)[0]!.nextDate).toBe('2026-10-31');
    expect(expenses.runRecurring(db, '2026-10-02')).toBe(0); // nothing twice
    const made = expenses.listExpenses(db, { search: 'Landlord' });
    expect(made).toHaveLength(3);
    expect(made.every((e) => e.recurringId === r.id && e.status === 'paid')).toBe(true);
    expect(made.map((e) => e.date).sort()).toEqual(['2026-07-31', '2026-08-31', '2026-09-30']);
  });

  it('stop at the end date, and can be edited or removed', () => {
    const r = expenses.createRecurring(db, { ...rent, nextDate: '2026-08-01', endDate: '2026-09-15' });
    expect(expenses.dueRecurring(db, '2026-12-01')[0]!.dates).toEqual(['2026-08-01', '2026-09-01']);
    expenses.updateRecurring(db, r.id, { ...rent, amountPaise: rupees(16000), nextDate: '2026-08-01' });
    expect(expenses.listRecurring(db)[0]!.amountPaise).toBe(rupees(16000));
    expenses.deleteRecurring(db, r.id);
    expect(expenses.listRecurring(db)).toEqual([]);
    expect(() => expenses.deleteRecurring(db, r.id)).toThrow(/no longer exists/);
  });

  it('are checked: a real next day, an end not before it, GST within the amount', () => {
    expect(() => expenses.createRecurring(db, { ...rent, nextDate: 'soon' })).toThrow(/next day/);
    expect(() => expenses.createRecurring(db, { ...rent, nextDate: '2026-08-01', endDate: '2026-07-01' })).toThrow(/end date/);
    expect(() => expenses.createRecurring(db, { ...rent, nextDate: '2026-08-01', gstPaise: rupees(99999) })).toThrow(/can't be more/);
  });
});

describe('budgets', () => {
  it('compare this month with each limit, calling out the ones near or over', () => {
    saveSettings(db, { expenseBudgets: { Rent: rupees(1000), Tea: rupees(500), Fuel: rupees(2000) } });
    spend({ category: 'Rent', amountPaise: rupees(1200) });
    spend({ category: 'tea', amountPaise: rupees(450) });
    spend({ category: 'Fuel', amountPaise: rupees(100) });
    spend({ category: 'Rent', amountPaise: rupees(9000), date: addDays(today, -60) }); // another month
    const lines = expenses.budgetStatus(db, today);
    expect(lines.map((l) => [l.category, l.status, Math.round(l.percent)])).toEqual([['Rent', 'over', 120], ['Tea', 'near', 90], ['Fuel', 'ok', 5]]);
  });

  it('is empty when there are no budgets', () => {
    expect(expenses.budgetStatus(db, today)).toEqual([]);
  });
});
