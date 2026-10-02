// Code 128, subset B: every printable ASCII character, which is what SKUs and shop barcodes use. Every barcode scanner reads it.
// Each symbol is six alternating bar and space widths totalling 11 modules; the stop symbol has seven, totalling 13.

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232',
  '2331112',
] as const;
const START_B = 104;
const STOP = 106;

export const CODE128_PATTERNS = PATTERNS;

/** True when every character can be encoded (printable ASCII, no control characters). */
export const canEncode128 = (text: string): boolean => text.length > 0 && /^[\x20-\x7E]+$/.test(text);

/** The symbol values for a text: start B, one per character, the check symbol, stop. */
export function code128Values(text: string): number[] {
  if (!canEncode128(text)) throw new Error('This text cannot be made into a barcode.');
  const values = [...text].map((ch) => ch.charCodeAt(0) - 32);
  const check = values.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  return [START_B, ...values, check, STOP];
}

/** Alternating bar, space, bar… widths in modules, starting with a bar. Add a quiet zone of 10 modules each side when drawing. */
export function code128Widths(text: string): number[] {
  return code128Values(text).flatMap((v) => [...PATTERNS[v]!].map(Number));
}

/** Reads widths back into text (checks the check symbol); used by the tests to prove the encoder and table agree. */
export function decode128(widths: number[]): string | null {
  const symbols: number[] = [];
  let i = 0;
  while (i < widths.length) {
    const take = i + 7 <= widths.length && widths.slice(i, i + 7).join('') === PATTERNS[STOP] ? 7 : 6;
    const key = widths.slice(i, i + take).join('');
    const value = PATTERNS.indexOf(key as (typeof PATTERNS)[number]);
    if (value < 0) return null;
    symbols.push(value);
    i += take;
  }
  if (symbols[0] !== START_B || symbols[symbols.length - 1] !== STOP || symbols.length < 4) return null;
  const body = symbols.slice(1, -2);
  const check = symbols[symbols.length - 2]!;
  const expected = body.reduce((sum, v, k) => sum + v * (k + 1), START_B) % 103;
  if (check !== expected) return null;
  return body.map((v) => String.fromCharCode(v + 32)).join('');
}
