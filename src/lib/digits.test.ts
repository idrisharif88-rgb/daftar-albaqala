import { describe, it, expect } from 'vitest';
import { toLatinDigits, numericInput, phoneInput } from './digits';

// An Arabic keyboard types ٠١٢٣, and everything downstream — Number(), MySQL,
// the spreadsheet, the SMS — treats those as letters.

describe('toLatinDigits', () => {
  it('converts Arabic-Indic digits', () => {
    expect(toLatinDigits('١٢٣')).toBe('123');
    expect(toLatinDigits('٠٩')).toBe('09');
  });

  it('converts the Persian/Urdu shapes of the same digits', () => {
    expect(toLatinDigits('۱۲۳')).toBe('123');
  });

  it('leaves Arabic letters and Latin digits alone', () => {
    expect(toLatinDigits('جبن 3')).toBe('جبن 3');
  });
});

describe('numericInput', () => {
  it('accepts an amount typed on an Arabic keyboard', () => {
    expect(numericInput('١٧٠٠')).toBe('1700');
  });

  it('takes ٫ and , as the decimal point the code parses with', () => {
    expect(numericInput('١٢٫٥')).toBe('12.5');
    expect(numericInput('12,5')).toBe('12.5');
  });

  it('drops what would turn the amount into NaN', () => {
    expect(numericInput('1 700 ريال')).toBe('1700');
    expect(numericInput('١٬٧٠٠')).toBe('1700'); // ٬ is a thousands separator
    expect(Number(numericInput('12.5abc'))).toBe(12.5);
  });

  it('keeps a single decimal point', () => {
    expect(numericInput('1.2.3')).toBe('1.23');
  });
});

describe('phoneInput', () => {
  it('normalises a number typed in Arabic digits', () => {
    expect(phoneInput('٧٧٥٥٨٩٠٤٠')).toBe('775589040');
    expect(phoneInput('+٩٦٧ ٧٧٥-٥٨٩-٠٤٠')).toBe('+967 775-589-040');
  });
});
