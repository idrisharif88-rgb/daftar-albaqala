import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import './SplashIntro.css';
import { FLAVOR } from '../flavors';

// The animated opening screen, played once per launch, over everything.
//
// ON THE PHONE this component draws nothing: Android shows the same screen
// itself (NativeSplash.java), because the page needs ~1.5s to start. Here it
// only waits for Android's «done» signal. What is below is what the browser
// shows.
//
// Android's launch window (launch_green.xml) and the boot placeholder in
// index.html already show the app icon in the same spot, so nothing jumps.
//
// The fingerprint lock waits for it (whenSplashDone), so Samsung's sheet
// never covers the opening screen.

// The app icon, briefly — no artificial wait (owner's choice, 2026-11-20:
// the opening screen shows the icon the user tapped, for every business).
const SHOW_MS = 600;
const FADE_MS = 350;

const reducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let resolveDone: () => void = () => {};
const done = new Promise<void>((resolve) => { resolveDone = resolve; });

/** Resolves once the opening screen has gone. */
export function whenSplashDone(): Promise<void> {
  return done;
}

const NATIVE = Capacitor.isNativePlatform();

// On the phone, done = Android's overlay has gone (it sets the flag and fires
// the event). The timeout only covers an overlay that somehow never reports.
if (NATIVE) {
  const w = window as Window & { __nativeSplashDone?: boolean };
  if (w.__nativeSplashDone) resolveDone();
  window.addEventListener('nativesplashdone', () => resolveDone(), { once: true });
  setTimeout(() => resolveDone(), 10000);
}

// Once per launch: a hot reload or a remount must not replay it. The clock is
// shared too — React's development mode runs the effect twice, and a second
// run that skipped the timers left the intro on screen for good.
let played = NATIVE;
let startedAt = 0;

const SplashIntro: React.FC = () => {
  const [phase, setPhase] = useState<'showing' | 'leaving' | 'gone'>(
    played ? 'gone' : 'showing',
  );

  useEffect(() => {
    // The plain green placeholder in index.html has done its job.
    document.getElementById('boot-splash')?.remove();
    if (NATIVE) return;
    played = true;
    startedAt ||= Date.now();
    const elapsed = Date.now() - startedAt;
    const show = reducedMotion() ? 300 : FLAVOR.scene?.ms ?? SHOW_MS;
    const leave = setTimeout(() => setPhase('leaving'), Math.max(0, show - elapsed));
    const gone = setTimeout(() => { setPhase('gone'); resolveDone(); },
      Math.max(0, show + FADE_MS - elapsed));
    return () => { clearTimeout(leave); clearTimeout(gone); resolveDone(); };
  }, []);

  if (phase === 'gone') return null;

  if (FLAVOR.scene) {
    return (
      <div
        className={`splash-intro splash-intro--scene${phase === 'leaving' ? ' splash-intro--leaving' : ''}`}
        aria-hidden="true"
      >
        <iframe src={FLAVOR.scene.src} title="" tabIndex={-1} />
      </div>
    );
  }

  // The browser's copy of the native opening screen: the app icon on green and
  // the name at the bottom (NativeSplash.java draws the same on the phone).
  return (
    <div
      className={`splash-intro splash-intro--icon${phase === 'leaving' ? ' splash-intro--leaving' : ''}`}
      aria-hidden="true"
    >
      <svg className="splash-intro__icon" viewBox="18 18 72 72" width="160" height="160">
          <clipPath id="spl-c"><circle cx="54" cy="54" r="36"/></clipPath>
          <g clipPath="url(#spl-c)">
            <rect width="108" height="108" fill="#2E7D32"/>
            <circle cx="54" cy="54" r="46" fill="#37903C"/>
            <path fill="#FBF3E3" d="M39,31 H69 A5,5 0 0 1 74,36 V72 A5,5 0 0 1 69,77 H39 A5,5 0 0 1 34,72 V36 A5,5 0 0 1 39,31 Z"/>
            <path stroke="#E24C4B" strokeWidth="2.5" strokeLinecap="round" d="M41,38 L41,70"/>
            <path stroke="#9DB6C7" strokeWidth="2.8" strokeLinecap="round" d="M46,44 L68,44 M46,54 L68,54 M46,64 L56,64"/>
            <circle cx="68" cy="68" r="10" fill="#F6C445"/>
            <circle cx="68" cy="68" r="6.5" fill="none" stroke="#DBA400" strokeWidth="2"/>
          </g>
      </svg>
      <div className="splash-intro__brand">فليكتب | Shopbook</div>
    </div>
  );
};

export default SplashIntro;
