import { describe, expect, it } from 'vitest';
import { canEncode128, code128Bars, code128Widths } from '../shared/barcode';

// Reference values produced by bwip-js, an independent Code 128 implementation (see README: how the barcode table was checked).
const REFERENCE: Record<string, string> = {
  'MG-001-MAR-6.3M': '2112141131232113131221321231221231221232211221321131231113232311311221322231121222312211321131234111132331112',
  Hello: '2112142311131122142211142211141341112211142331112',
  'ABC-123': '2112141113231311231313211221321232212232112211321124122331112',
  'a b~': '2112141211242122221214211311412231122331112',
};

describe('Code 128 barcodes', () => {
  it('matches an independent implementation exactly', () => {
    for (const [text, widths] of Object.entries(REFERENCE)) expect(code128Widths(text).join('')).toBe(widths);
  });

  it('builds well formed symbols: 11 modules each, three bars and three spaces, ending in the stop pattern', () => {
    const text = 'MG-010-ROYAL BLUE-6.3M';
    const widths = code128Widths(text);
    // start + characters + check digit = 11 modules and 6 elements each; the stop is 13 modules and 7 elements
    expect(widths.length).toBe((text.length + 2) * 6 + 7);
    expect(widths.reduce((a, b) => a + b, 0)).toBe((text.length + 2) * 11 + 13);
    expect(widths.slice(-7).join('')).toBe('2331112');
    expect(widths.slice(0, 6).join('')).toBe('211214'); // start B
  });

  it('lays the bars out from zero, alternating with spaces', () => {
    const { bars, modules } = code128Bars('A');
    expect(bars[0]).toEqual({ x: 0, w: 2 });
    expect(modules).toBe(11 * 3 + 13);
    for (let i = 1; i < bars.length; i++) expect(bars[i]!.x).toBeGreaterThan(bars[i - 1]!.x + bars[i - 1]!.w - 1);
    const last = bars[bars.length - 1]!;
    expect(last.x + last.w).toBe(modules); // the stop pattern ends on a bar
  });

  it('knows what it can hold, and refuses the rest', () => {
    expect(canEncode128('MG-001-MAR-6.3M')).toBe(true);
    expect(canEncode128('')).toBe(false);
    expect(canEncode128('साड़ी')).toBe(false);
    expect(canEncode128('Blue – 6.3m')).toBe(false); // an en dash is not ASCII
    expect(canEncode128('x'.repeat(41))).toBe(false);
    expect(() => code128Widths('साड़ी')).toThrow(/cannot be made into a barcode/);
  });
});
