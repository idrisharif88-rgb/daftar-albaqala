// Numbers are typed on an ARABIC keyboard, which produces Arabic-Indic digits
// (٠١٢٣) rather than the Latin ones (0123) the rest of the app is built on.
//
// The app reads and writes Latin digits everywhere on purpose: money is stored
// as an integer, `formatMinor` prints with the `en-US` locale, and the sums are
// done by JavaScript, which parses «١٢٣» as NaN. Beyond the app, the ledger is
// also read by MySQL, a spreadsheet and an SMS gateway — none of which treat
// «١٢٣» as a number.
//
// The old fields were `type="number"`, and a number input SANITISES what it
// cannot parse: typing «١٢٣» left the field empty and the app never saw the
// characters at all, so there was nothing to convert. They are plain text
// fields now, still with `inputmode="decimal"` so the numeric keypad opens, and
// what is typed passes through here.

// U+0660–0669 Arabic-Indic, U+06F0–06F9 the Persian/Urdu shapes of the same
// digits — an Arabic keyboard on Android may send either.
const ARABIC_INDIC = /[٠-٩۰-۹]/g;

/** «١٢٣» -> «123». Leaves everything else untouched. */
export function toLatinDigits(text: string): string {
  return text.replace(ARABIC_INDIC, (d) => {
    const code = d.charCodeAt(0);
    const zero = code >= 0x06F0 ? 0x06F0 : 0x0660;
    return String(code - zero);
  });
}

/**
 * What a money field is allowed to hold: Latin digits and at most one decimal
 * point.
 *
 * The Arabic decimal separator (٫) and a comma both become the point the code
 * parses with, and anything else is dropped as it is typed — a letter that
 * reaches `Number()` turns the whole amount into NaN, and the owner would have
 * no way to see which character did it.
 */
export function numericInput(text: string): string {
  const latin = toLatinDigits(text)
    .replace(/[٫,]/g, '.')   // ٫ and , are both meant as the decimal point
    .replace(/[^0-9.]/g, '');     // ٬ thousands separators, spaces, letters
  const [whole, ...rest] = latin.split('.');
  return rest.length > 0 ? `${whole}.${rest.join('')}` : whole;
}

/** A phone number as it is typed: digits only, in Latin. */
export function phoneInput(text: string): string {
  return toLatinDigits(text).replace(/[^\d+ -]/g, '');
}
