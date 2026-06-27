// Money is stored locally as INTEGER minor units (1/100), matching the server's
// DECIMAL(12,2) — see CLAUDE.md. Keeping it integer avoids floating-point cent
// errors. e.g. 5000.00 YER  <->  500000 minor units.

const MINOR_PER_MAJOR = 100;

// Major (e.g. 5000 or 5000.5 riyal) -> integer minor units. Rounds to the cent.
export function toMinor(major: number): number {
  return Math.round(major * MINOR_PER_MAJOR);
}

// Integer minor units -> major number (e.g. 500050 -> 5000.5).
export function fromMinor(minor: number): number {
  return minor / MINOR_PER_MAJOR;
}

// Format minor units for display, e.g. 500000 -> "5,000.00". Currency symbol is
// added by the UI (default YER) so this stays presentation-light.
export function formatMinor(minor: number): string {
  return fromMinor(minor).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
