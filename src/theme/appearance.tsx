import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { DEVICE_PREFS, onPrefsArrived, prefChanged } from '../lib/prefKeys';

// The app's look: an accent colour and day/night — copied from «خماسيات».
//
//   - The COLOUR is the owner's choice, kept in localStorage and synced with
//     the account (lib/prefKeys.ts), so a new phone comes up in his colour.
//     One tap in Settings moves to the next: green → gold → orange → green.
//   - NIGHT follows the phone. On launch the app takes Android's dark-mode
//     setting, and whenever the phone switches, the app switches with it. The
//     «الوضع الليلي» switch flips it by hand until the phone next changes.
//
// Both land on <html>: `data-accent` and Ionic's `.ion-palette-dark` class. The
// colours themselves live in theme/variables.css.

export type Accent = 'green' | 'gold' | 'orange';

export const ACCENTS: Accent[] = ['green', 'gold', 'orange'];
export const DEFAULT_ACCENT: Accent = 'green';
export const ACCENT_NAMES: Record<Accent, string> = {
  green: 'أخضر',
  gold: 'ذهبي',
  orange: 'برتقالي',
};

export const nextAccent = (current: Accent): Accent =>
  ACCENTS[(ACCENTS.indexOf(current) + 1) % ACCENTS.length];

// The header bar's colour — the same in day and night, dark enough for white
// text in both. Must match --app-bar in variables.css: the status bar above the
// header takes it, or the two show as different bands.
const BAR_COLOR: Record<Accent, string> = {
  green: '#1b5e20',
  gold: '#7a6000',
  orange: '#9a3412',
};

const ACCENT_KEY = DEVICE_PREFS.ui_accent;

function loadAccent(): Accent {
  try {
    const value = localStorage.getItem(ACCENT_KEY);
    return ACCENTS.includes(value as Accent) ? (value as Accent) : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

const darkQuery = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** Put the look on the page. Exported so main.tsx can apply it before the
 *  first paint — otherwise a night-mode phone flashes white on every launch. */
export function applyAppearance(accent: Accent, night: boolean): void {
  const root = document.documentElement;
  root.dataset.accent = accent;
  root.classList.toggle('ion-palette-dark', night);
  if (Capacitor.getPlatform() === 'android') {
    // White icons on the header-coloured bar, in both modes.
    void StatusBar.setBackgroundColor({ color: BAR_COLOR[accent] }).catch(() => undefined);
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
  }
}

export const initialAppearance = () => ({
  accent: loadAccent(),
  night: darkQuery()?.matches ?? false,
});

interface AppearanceState {
  accent: Accent;
  night: boolean;
  cycleAccent: () => void;
  toggleNight: () => void;
}

const AppearanceContext = createContext<AppearanceState | undefined>(undefined);

export const AppearanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accent, setAccent] = useState<Accent>(() => initialAppearance().accent);
  const [night, setNight] = useState<boolean>(() => initialAppearance().night);

  useEffect(() => { applyAppearance(accent, night); }, [accent, night]);

  // The colour chosen on another phone, arriving with a sync.
  useEffect(() => onPrefsArrived((keys) => {
    if (keys.includes('ui_accent')) setAccent(loadAccent());
  }), []);

  // Follow the phone: each time Android's dark mode flips, the app flips too —
  // even after the owner flipped it by hand.
  useEffect(() => {
    const mq = darkQuery();
    if (!mq) return undefined;
    const onChange = (e: MediaQueryListEvent) => setNight(e.matches);
    // Older WebViews (and the test environment) only have the deprecated
    // addListener on a MediaQueryList, not addEventListener.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const cycleAccent = useCallback(() => {
    setAccent((current) => {
      const next = nextAccent(current);
      try { localStorage.setItem(ACCENT_KEY, next); } catch { /* still applied */ }
      prefChanged('ui_accent');
      return next;
    });
  }, []);

  const toggleNight = useCallback(() => setNight((n) => !n), []);

  return (
    <AppearanceContext.Provider value={{ accent, night, cycleAccent, toggleNight }}>
      {children}
    </AppearanceContext.Provider>
  );
};

export function useAppearance(): AppearanceState {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used within <AppearanceProvider>');
  return ctx;
}
