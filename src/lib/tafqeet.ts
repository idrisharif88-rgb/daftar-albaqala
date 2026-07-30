import { fromMinor } from '../data/money';

// تفقيط — writing a number out in Arabic words.
//
// Every notification ends with the balance spelled out in letters as well as
// digits, the way a receipt or a cheque does. The reason is practical, not
// decorative: an SMS crossing a bad line, a screenshot forwarded on WhatsApp, a
// digit read as another — words are the check on the figure, and in a book
// about who owes whom that check is worth the extra line.
//
// Only the riyal total is spelled out (that is the one figure both sides argue
// about), so the currency inflection here covers YER; other currencies keep
// their digits and their own label.

const ONES = [
  '', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
  'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر',
];

const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];

const HUNDREDS = [
  '', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة',
];

// Arabic counts its scale words in four shapes, picked by the number in front
// of them: ألف / ألفان / ثلاثة آلاف / خمسة وعشرون ألفاً. `twoIdafa` is the dual
// with the nun dropped, used when the scale word is followed by what it counts
// («ألفا ريال», not «ألفان ريال»).
interface Scale {
  one: string;
  two: string;
  twoIdafa: string;
  few: string;   // 3–10
  many: string;  // 11–99, standing alone
}

const SCALES: (Scale | null)[] = [
  null, // units — no scale word
  { one: 'ألف',      two: 'ألفان',      twoIdafa: 'ألفا',      few: 'آلاف',     many: 'ألفاً' },
  { one: 'مليون',    two: 'مليونان',    twoIdafa: 'مليونا',    few: 'ملايين',   many: 'مليوناً' },
  { one: 'مليار',    two: 'ملياران',    twoIdafa: 'مليارا',    few: 'مليارات',  many: 'ملياراً' },
  { one: 'تريليون',  two: 'تريليونان',  twoIdafa: 'تريليونا',  few: 'تريليونات', many: 'تريليوناً' },
];

/** The counted noun, in the four shapes Arabic needs. */
export interface CountedWords {
  one: string;   // ريال
  two: string;   // ريالان
  few: string;   // ريالات   (3–10)
  many: string;  // ريالاً   (11–99)
}

const YER_WORDS: CountedWords = {
  one: 'ريال', two: 'ريالان', few: 'ريالات', many: 'ريالاً',
};

// 1–999. `idafa` = something this group counts follows it, which is the only
// place «مئتان» has to shrink to «مئتا».
function under1000(n: number, idafa: boolean): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;

  if (h) parts.push(idafa && h === 2 && r === 0 ? 'مئتا' : HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else {
      const units = r % 10;
      const tens = TENS[Math.floor(r / 10)];
      // Arabic says the unit first: «خمسة وعشرون».
      parts.push(units ? `${ONES[units]} و${tens}` : tens);
    }
  }
  // The و attaches to the following word, so a plain ' و' join is right.
  return parts.join(' و');
}

// One 3-digit group plus its scale word («أربعة وثلاثون ألفاً»).
function groupWords(n: number, scaleIndex: number, idafa: boolean): string {
  const scale = SCALES[scaleIndex];
  if (!scale) return under1000(n, idafa);
  if (n === 1) return scale.one;
  if (n === 2) return idafa ? scale.twoIdafa : scale.two;

  const r = n % 100;
  // 3–10 take the plural; 11–99 take the accusative singular — unless something
  // counted follows, which puts it back in the bare form («ألف ريال»).
  const word = r >= 3 && r <= 10 ? scale.few : r >= 11 ? (idafa ? scale.one : scale.many) : scale.one;
  // The count is always in construct with its own scale word — «مئتا ألف».
  return `${under1000(n, true)} ${word}`;
}

/**
 * A non-negative integer in Arabic words — «أربعة وثلاثون ألفاً».
 * `counted` = a noun will follow the number, so the last group is written in
 * the construct form («أربعة وثلاثون ألف …»).
 */
export function numberToArabicWords(n: number, counted = false): string {
  const value = Math.floor(Math.abs(n));
  if (value === 0) return 'صفر';

  // Split into 3-digit groups, lowest first.
  const groups: { value: number; scale: number }[] = [];
  let rest = value;
  let scale = 0;
  while (rest > 0 && scale < SCALES.length) {
    groups.push({ value: rest % 1000, scale });
    rest = Math.floor(rest / 1000);
    scale++;
  }

  // Only the LAST spoken group is in construct with the noun that follows.
  const lastSpoken = groups.find((g) => g.value !== 0);
  const parts: string[] = [];
  for (const g of [...groups].reverse()) {
    if (g.value === 0) continue;
    parts.push(groupWords(g.value, g.scale, counted && g === lastSpoken));
  }
  return parts.join(' و');
}

/**
 * The word for the counted noun, chosen by the number in front of it:
 * «ريال واحد» / «ريالان» / «خمسة ريالات» / «خمسة وعشرون ريالاً» / «ألف ريال».
 */
function countedWord(n: number, words: CountedWords): string {
  // «... ألف ريال» — a round scale leaves the noun singular.
  if (n % 1000 === 0) return words.one;
  const r = n % 100;
  if (r === 0) return words.one;          // مئة ريال
  if (r === 1) return words.one;
  if (r === 2) return words.two;
  if (r <= 10) return words.few;
  return words.many;
}

/** «34,000» → «أربعة وثلاثون ألف ريال». Whole units only — a balance is spelled
 *  out to be read aloud, and fractions of a riyal are not used in practice. */
export function amountToArabicWords(
  amount: number,
  words: CountedWords = YER_WORDS,
): string {
  const n = Math.round(Math.abs(amount));
  if (n === 0) return `صفر ${words.one}`;
  if (n === 1) return `${words.one} واحد`;
  if (n === 2) return words.two;
  return `${numberToArabicWords(n, true)} ${countedWord(n, words)}`;
}

/** Same, taking the INTEGER minor units the app stores money in. */
export function tafqeetBaseMinor(minor: number): string {
  return amountToArabicWords(fromMinor(minor));
}
