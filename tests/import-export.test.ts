import { describe, expect, it } from 'vitest';
import { headingKey, mapHeadings, parseTable } from '../shared/csvParse';
import { parseCustomerRows, parseExpenseRows, readDate, readMethod } from '../shared/importRows';
import { crc32, makeZip, toBase64 } from '../shared/zip';

describe('reading a spreadsheet', () => {
  it('reads commas, tabs and semicolons', () => {
    expect(parseTable('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(parseTable('a\tb\tc\n1\t2\t3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(parseTable('a;b;c\n1;2,5;3')).toEqual([['a', 'b', 'c'], ['1', '2,5', '3']]);
  });

  it('handles quotes, doubled quotes, line breaks inside a cell, a BOM and Windows line endings', () => {
    expect(parseTable('﻿name,note\r\n"Sunita, Devi","She said ""hello"""\r\n"Two\nlines",x')).toEqual([
      ['name', 'note'],
      ['Sunita, Devi', 'She said "hello"'],
      ['Two\nlines', 'x'],
    ]);
  });

  it('skips blank lines, trims cells, and copes with a missing final newline or an empty file', () => {
    expect(parseTable('a , b\n\n  \n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseTable('')).toEqual([]);
    expect(parseTable('\n\n')).toEqual([]);
  });

  it('matches headings by the names people use', () => {
    expect(headingKey('Paid To')).toBe('paidto');
    expect(headingKey('Mobile No.')).toBe('mobileno');
    expect(mapHeadings(['Customer Name', 'Mobile', 'GST No'], { name: ['customername'], phone: ['mobile'], gstin: ['gstno'] })).toEqual({ name: 0, phone: 1, gstin: 2 });
    expect(mapHeadings(['Sunita', '9876543210'], { name: ['name'], phone: ['phone'] })).toBeNull(); // data, not headings
  });
});

describe('customers from a sheet', () => {
  it('reads headings in any order and makes a customer with a GSTIN a business', () => {
    const p = parseCustomerRows('Mobile,Customer,GSTIN,City\n9876543210,Sunita Devi,,Mau\n9000000001,Kanchan Sarees,09aabck1234m1zi,Varanasi');
    expect(p.problems).toEqual([]);
    expect(p.rows.map((r) => r.value)).toEqual([
      expect.objectContaining({ name: 'Sunita Devi', type: 'B2C', phone: '9876543210', city: 'Mau', gstin: '' }),
      expect.objectContaining({ name: 'Kanchan Sarees', type: 'B2B', gstin: '09AABCK1234M1ZI', city: 'Varanasi' }),
    ]);
    expect(p.rows.map((r) => r.row)).toEqual([2, 3]);
  });

  it('reads columns in a fixed order when there are no headings', () => {
    const p = parseCustomerRows('Meena,B2C,9111111111,meena@example.com');
    expect(p.rows[0]!.value).toMatchObject({ name: 'Meena', type: 'B2C', phone: '9111111111', email: 'meena@example.com' });
    expect(p.rows[0]!.row).toBe(1);
  });

  it('flags a row with no name and keeps the others', () => {
    const p = parseCustomerRows('Name,Phone\nA,1\n,2\nC,3');
    expect(p.rows.map((r) => r.value.name)).toEqual(['A', 'C']);
    expect(p.problems).toEqual([{ row: 3, message: 'There is no name.' }]);
  });
});

describe('expenses from a sheet', () => {
  it('reads dates written the Indian way, rupee amounts with commas, and loose payment words', () => {
    const p = parseExpenseRows('Date,Category,Paid To,Paid By,Amount,Ref,Note\n30/09/2026,Rent,Landlord,NEFT,"₹12,000.50",UTR1,Sept\n2026-09-29,Tea,,GPay,45,,');
    expect(p.problems).toEqual([]);
    expect(p.rows[0]!.value).toEqual({ date: '2026-09-30', category: 'Rent', vendor: 'Landlord', method: 'bank', amountPaise: 1200050, reference: 'UTR1', note: 'Sept' });
    expect(p.rows[1]!.value).toMatchObject({ date: '2026-09-29', method: 'upi', amountPaise: 4500, vendor: '' });
  });

  it('says exactly what is wrong with each bad row', () => {
    const p = parseExpenseRows('Date,Category,Amount,Paid By\n31/02/2026,Rent,100,cash\n01/09/2026,,100,cash\n01/09/2026,Rent,abc,cash\n01/09/2026,Rent,100,barter\n01/09/2026,Rent,0,cash');
    expect(p.rows).toEqual([]);
    expect(p.problems.map((x) => x.row)).toEqual([2, 3, 4, 5, 6]);
    expect(p.problems[0]!.message).toContain('isn\'t a date');
    expect(p.problems[1]!.message).toBe('There is no category.');
    expect(p.problems[2]!.message).toContain('isn\'t an amount');
    expect(p.problems[3]!.message).toContain('way of paying');
    expect(p.problems[4]!.message).toContain('isn\'t an amount');
  });

  it('defaults to cash when the method is blank, and uses a fixed order without headings', () => {
    const p = parseExpenseRows('01/09/2026,Rent,Landlord,,500');
    expect(p.rows[0]!.value).toMatchObject({ method: 'cash', amountPaise: 50000, vendor: 'Landlord' });
  });

  it('knows its dates and methods', () => {
    expect(readDate('1/9/2026')).toBe('2026-09-01');
    expect(readDate('30.09.2026')).toBe('2026-09-30');
    expect(readDate('29/02/2026')).toBe('');
    expect(readDate('soon')).toBe('');
    expect(readMethod('Bank transfer')).toBe('bank');
    expect(readMethod('PhonePe')).toBe('upi');
    expect(readMethod('Cheque')).toBe('cheque');
    expect(readMethod('')).toBe('cash');
    expect(readMethod('barter')).toBe('');
  });
});

describe('zip files', () => {
  it('computes the standard checksum', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  /** Reads the archive back through its own directory, the way an unzip tool does. */
  function readZip(bytes: Uint8Array) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = bytes.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    const count = v.getUint16(end + 10, true);
    let at = v.getUint32(end + 16, true);
    const out: { name: string; text: string; crcOk: boolean }[] = [];
    for (let i = 0; i < count; i++) {
      expect(v.getUint32(at, true)).toBe(0x02014b50);
      const crc = v.getUint32(at + 16, true);
      const size = v.getUint32(at + 20, true);
      const nameLen = v.getUint16(at + 28, true);
      const local = v.getUint32(at + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
      expect(v.getUint32(local, true)).toBe(0x04034b50);
      const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = bytes.subarray(dataAt, dataAt + size);
      out.push({ name, text: new TextDecoder().decode(data), crcOk: crc32(data) === crc });
      at += 46 + nameLen;
    }
    return out;
  }

  it('packs several files that can be read back exactly, including non-English names and text', () => {
    const files = [
      { name: 'customers.csv', content: 'name,phone\r\nसुनीता,98765\r\n' },
      { name: 'invoices/2026.csv', content: 'a,b\n1,2\n' },
      { name: 'empty.csv', content: '' },
      { name: 'raw.bin', content: new Uint8Array([0, 1, 2, 255]) },
    ];
    const back = readZip(makeZip(files, new Date(2026, 9, 2, 10, 30, 40)));
    expect(back.map((f) => f.name)).toEqual(['customers.csv', 'invoices/2026.csv', 'empty.csv', 'raw.bin']);
    expect(back[0]!.text).toBe('name,phone\r\nसुनीता,98765\r\n');
    expect(back[2]!.text).toBe('');
    expect(back.every((f) => f.crcOk)).toBe(true);
  });

  it('writes an empty archive as just the end marker, and turns bytes into base64', () => {
    expect(makeZip([]).length).toBe(22);
    expect(toBase64(new Uint8Array([72, 105]))).toBe('SGk=');
    const big = new Uint8Array(100_000).fill(65);
    expect(atob(toBase64(big)).length).toBe(100_000);
  });
});
