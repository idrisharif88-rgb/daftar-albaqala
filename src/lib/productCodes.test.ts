import { describe, expect, it } from 'vitest';
import { ean13CheckDigit, generateCodes, parseScannedCode } from './productCodes';

describe('productCodes', () => {
  it('makes unique, valid EAN-13 codes in the in-store range', () => {
    const codes = generateCodes(500);
    expect(new Set(codes).size).toBe(500);
    for (const c of codes) {
      expect(c).toMatch(/^2\d{12}$/);
      expect(parseScannedCode(c)).toBe(c);
    }
  });

  it('computes the standard check digit', () => {
    // 6 285602 015254 — the barcode on a real product (from the owner's photo).
    expect(ean13CheckDigit('628560201525')).toBe(4);
  });

  it('never repeats a code that is already in use', () => {
    const first = generateCodes(50);
    const more = generateCodes(50, first);
    expect(more.some((c) => first.includes(c))).toBe(false);
  });

  it('refuses a misread, a foreign barcode and other QR/text', () => {
    const [c] = generateCodes(1);
    const wrong = c.slice(0, 12) + ((Number(c[12]) + 1) % 10);
    expect(parseScannedCode(wrong)).toBeNull();
    expect(parseScannedCode('6285602015254')).toBeNull(); // a real product, not ours
    expect(parseScannedCode('https://example.com')).toBeNull();
    expect(parseScannedCode(`  ${c}\n`)).toBe(c);
  });
});
