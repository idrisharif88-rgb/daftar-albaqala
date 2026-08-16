import { describe, it, expect } from 'vitest';
import { amountToArabicWords, numberToArabicWords, tafqeetBaseMinor } from './tafqeet';
import { toMinor } from '../data/money';

// The words go out to contacts as the check on the digits, so the grammar has
// to hold for the shapes real balances take: round thousands, mixed hundreds,
// the 3–10 plural, and the 11–99 accusative.

describe('numberToArabicWords', () => {
  it('handles the small numbers', () => {
    expect(numberToArabicWords(0)).toBe('صفر');
    expect(numberToArabicWords(7)).toBe('سبعة');
    expect(numberToArabicWords(15)).toBe('خمسة عشر');
    expect(numberToArabicWords(25)).toBe('خمسة وعشرون');
    expect(numberToArabicWords(100)).toBe('مائة');
    expect(numberToArabicWords(250)).toBe('مائتان وخمسون');
  });

  it('picks the right shape for each scale word', () => {
    expect(numberToArabicWords(1000)).toBe('ألف');
    expect(numberToArabicWords(2000)).toBe('ألفان');
    expect(numberToArabicWords(5000)).toBe('خمسة آلاف');
    expect(numberToArabicWords(34000)).toBe('أربعة وثلاثون ألفاً');
    expect(numberToArabicWords(1_000_000)).toBe('مليون');
    expect(numberToArabicWords(3_000_000)).toBe('ثلاثة ملايين');
  });

  it('joins groups with و', () => {
    expect(numberToArabicWords(1500)).toBe('ألف وخمسمائة');
    expect(numberToArabicWords(1_234_567)).toBe(
      'مليون ومائتان وأربعة وثلاثون ألفاً وخمسمائة وسبعة وستون'
    );
  });
});

describe('amountToArabicWords', () => {
  it('inflects the riyal after the number', () => {
    expect(amountToArabicWords(1)).toBe('ريال واحد');
    expect(amountToArabicWords(2)).toBe('ريالان');
    expect(amountToArabicWords(5)).toBe('خمسة ريالات');
    expect(amountToArabicWords(11)).toBe('أحد عشر ريالاً');
    expect(amountToArabicWords(50)).toBe('خمسون ريالاً');
    expect(amountToArabicWords(100)).toBe('مائة ريال');
  });

  // A scale word directly in front of the noun loses its tanween/nun:
  // «أربعة وثلاثون ألف ريال», not «... ألفاً ريال».
  it('puts the last scale word in the construct form', () => {
    expect(amountToArabicWords(2000)).toBe('ألفا ريال');
    expect(amountToArabicWords(5000)).toBe('خمسة آلاف ريال');
    expect(amountToArabicWords(14000)).toBe('أربعة عشر ألف ريال');
    expect(amountToArabicWords(20000)).toBe('عشرون ألف ريال');
    expect(amountToArabicWords(34000)).toBe('أربعة وثلاثون ألف ريال');
    expect(amountToArabicWords(200000)).toBe('مائتا ألف ريال');
  });

  it('reads the sign off the caller — the direction word carries it', () => {
    expect(amountToArabicWords(-5000)).toBe('خمسة آلاف ريال');
  });

  it('rounds away fractions of a riyal', () => {
    expect(amountToArabicWords(4999.6)).toBe('خمسة آلاف ريال');
  });
});

describe('tafqeetBaseMinor', () => {
  it('takes the minor units the app stores', () => {
    expect(tafqeetBaseMinor(toMinor(34000))).toBe('أربعة وثلاثون ألف ريال');
  });
});
