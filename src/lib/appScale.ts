import { useSyncExternalStore } from 'react';

// «حجم العرض» — make the whole app bigger or smaller, like Ctrl +/−. Copied
// from «خماسيات».
//
// A device setting, not synced: 100 is the phone's own size (the WebView already
// follows Android's font-size setting), and what suits a Note 9 is wrong on a
// tablet. It is CSS `zoom` on <html>. vh/vw would grow with the zoom and run off
// the screen, so --vh/--vw/--dvh are set here, divided back down — use those,
// never a bare `50vh`.
export const SCALE_KEY = 'daftar.app-scale';
export const ALL_SCALE_STEPS = [80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155];
export const DEFAULT_SCALE = 100;

// The ceilings were measured on the devices (shortest side, in CSS px): the
// Note 9 (411) is clean up to 110; the Tab S6 and Tab Active 3 (800) up to 155 —
// the Active 3 took 160 and the S6 did not, so the lower one holds for both.
// Between the two points the ceiling is a straight line; above 800 it stays at
// 155; below 410 it shrinks with the width.
const PHONE = { side: 410, max: 110 };
const TABLET = { side: 800, max: 155 };

const toStep = (value: number) => Math.floor(value / 5) * 5;

/** The largest zoom this screen can take — by its SHORTEST side, so turning the
 *  device does not change it. */
export function maxScaleFor(shortSide: number): number {
  let fit: number;
  if (shortSide >= TABLET.side) fit = TABLET.max;
  else if (shortSide >= PHONE.side) {
    const t = (shortSide - PHONE.side) / (TABLET.side - PHONE.side);
    fit = PHONE.max + t * (TABLET.max - PHONE.max);
  } else fit = (shortSide / PHONE.side) * PHONE.max;
  return Math.max(DEFAULT_SCALE, toStep(fit));
}

const deviceShortSide = () => Math.min(
  window.screen?.width || window.innerWidth,
  window.screen?.height || window.innerHeight,
);

export const scaleSteps = (shortSide = deviceShortSide()) => {
  const max = maxScaleFor(shortSide);
  return ALL_SCALE_STEPS.filter((s) => s <= max);
};

export function loadScale(): number {
  let value = DEFAULT_SCALE;
  try { value = Number(localStorage.getItem(SCALE_KEY)); } catch { /* default */ }
  if (!ALL_SCALE_STEPS.includes(value)) return DEFAULT_SCALE;
  return Math.min(value, maxScaleFor(deviceShortSide()));
}

const saveScale = (scale: number) => {
  try { localStorage.setItem(SCALE_KEY, String(scale)); } catch { /* applied anyway */ }
};

// Text grows HALF a step faster than everything else. Zoom alone enlarges the
// whole layout evenly, and the owner found the writing still too small at a
// size where the buttons and cards were already big enough — on a ledger the
// text IS the content. The boost is a root font-size, and every size in the app
// is in rem, so it reaches all of them in one go and keeps the same 5% grades.
// Each 5% step raises the layout by 5% and the text by about 10%, so the
// writing pulls ahead as you go up. Capped at +25% so the longest contact name
// still fits its row on a tablet at the top of the range.
const FONT_LEAD = 1;
const FONT_BOOST_MAX = 0.25;
const fontBoost = (scale: number) => {
  const extra = ((scale - DEFAULT_SCALE) / 100) * FONT_LEAD;
  return 1 + Math.min(extra, FONT_BOOST_MAX);
};

export function applyScale(scale: number): void {
  const root = document.documentElement;
  if (scale === DEFAULT_SCALE) {
    root.style.removeProperty('zoom');
    root.style.removeProperty('font-size');
    ['--vh', '--vw', '--dvh'].forEach((name) => root.style.removeProperty(name));
    return;
  }
  const factor = scale / 100;
  root.style.setProperty('zoom', String(factor));
  root.style.setProperty('font-size', `${(fontBoost(scale) * 100).toFixed(2)}%`);
  const vh = `${window.innerHeight / factor / 100}px`;
  root.style.setProperty('--vh', vh);
  root.style.setProperty('--dvh', vh);
  root.style.setProperty('--vw', `${window.innerWidth / factor / 100}px`);
}

// One value for the whole app: set from Settings, applied to <html>, read back
// by the dialog. A module-level store rather than component state, so the
// setting holds on every screen, not only while Settings is open.
let current = DEFAULT_SCALE;
const listeners = new Set<() => void>();

/** Apply the saved size before the first paint (main.tsx), and keep the screen
 *  units right when the window changes size (the keyboard, a rotation). */
export function initAppScale(): void {
  current = loadScale();
  applyScale(current);
  window.addEventListener('resize', () => applyScale(current));
}

function setScale(next: number): void {
  current = next;
  saveScale(next);
  applyScale(next);
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useAppScale() {
  const scale = useSyncExternalStore(subscribe, () => current);
  return { scale, setScale };
}
