import { describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, canEncode128, code128Values, code128Widths, decode128 } from '../shared/code128';

describe('Code 128 barcodes', () => {
  it('has a table every symbol of which is a valid pattern: 11 modules, 6 widths, all different', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    for (const [i, p] of CODE128_PATTERNS.entries()) {
      const digits = [...p].map(Number);
      expect(digits.reduce((a, b) => a + b, 0), `symbol ${i}`).toBe(i === 106 ? 13 : 11);
      expect(digits.length).toBe(i === 106 ? 7 : 6);
    }
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
  });

  it('works the check symbol out as the standard says', () => {
    // The standard's worked example "PJJ123C" gives 54 starting with subset A (103); starting with subset B (104) it is one more.
    const v = code128Values('PJJ123C');
    expect(v[0]).toBe(104);
    expect(v[v.length - 2]).toBe(55);
    expect(v[v.length - 1]).toBe(106);
    // And a few symbols everyone knows: space, "!", start B, stop.
    expect([CODE128_PATTERNS[0], CODE128_PATTERNS[1], CODE128_PATTERNS[104], CODE128_PATTERNS[106]]).toEqual(['212222', '222122', '211214', '2331112']);
  });

  it('decodes back to what was encoded, for SKUs and awkward text', () => {
    for (const text of ['MG-001-RED-6M', 'A', '8901234567890', 'x y ~!@#', 'mau/2026-27']) {
      expect(decode128(code128Widths(text)), text).toBe(text);
    }
  });

  it('refuses text it cannot draw, and notices a damaged barcode', () => {
    expect(canEncode128('')).toBe(false);
    expect(canEncode128('साड़ी')).toBe(false);
    expect(canEncode128('tab\there')).toBe(false);
    expect(() => code128Values('साड़ी')).toThrow();
    const w = code128Widths('MG-001');
    w[8] = w[8]! === 1 ? 2 : 1;
    expect(decode128(w)).toBeNull();
  });

  it('is eleven modules per symbol plus two for the end bar', () => {
    const text = 'ABC';
    expect(code128Widths(text).reduce((a, b) => a + b, 0)).toBe(11 * (1 + 3 + 1) + 13);
  });
});
