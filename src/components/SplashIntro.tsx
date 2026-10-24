import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import './SplashIntro.css';

// The animated opening screen, played once per launch, over everything.
//
// ON THE PHONE this component draws nothing: Android plays the same animation
// itself (NativeSplash.java), because the page needs ~1.5s to start and a
// web-drawn basket meant two baskets and a black flash at the hand-over. Here
// it only waits for Android's «done» signal. The animation below is what the
// browser shows.
//
// Android's launch window (launch_green.xml) and the boot placeholder in
// index.html already show the basket in the same spot, so this screen starts
// on the very picture they leave — no empty green, no white flash, no jump.
//
// The fingerprint lock waits for it (whenSplashDone): asking for a finger
// while the basket is still rolling would put Samsung's sheet over the
// animation.

// Basket and name until 2.4s, then the sample book held for about a second
// before the real app.
const SHOW_MS = 3600;
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

// Once per launch: a hot reload or a remount must not replay it.
let played = NATIVE;

const SplashIntro: React.FC = () => {
  const [phase, setPhase] = useState<'showing' | 'leaving' | 'gone'>(
    played ? 'gone' : 'showing',
  );

  useEffect(() => {
    // The plain green placeholder in index.html has done its job.
    document.getElementById('boot-splash')?.remove();
    if (NATIVE) return;
    if (played) { resolveDone(); return; }
    played = true;
    const show = reducedMotion() ? 300 : SHOW_MS;
    const leave = setTimeout(() => setPhase('leaving'), show);
    const gone = setTimeout(() => { setPhase('gone'); resolveDone(); }, show + FADE_MS);
    return () => { clearTimeout(leave); clearTimeout(gone); resolveDone(); };
  }, []);

  if (phase === 'gone') return null;

  return (
    <div
      className={`splash-intro${phase === 'leaving' ? ' splash-intro--leaving' : ''}`}
      aria-hidden="true"
    >
      <div className="splash-tile">
        <svg viewBox="0 0 64 64" fill="none">
          <path d="M8 12h7l6 28h28l6-20H18" stroke="#ffffff" strokeWidth="5"
            strokeLinecap="round" strokeLinejoin="round" />
          <circle className="splash-intro__wheel" cx="25" cy="50" r="4.5" fill="#ffffff" />
          <circle className="splash-intro__wheel" cx="45" cy="50" r="4.5" fill="#ffffff" />
        </svg>
      </div>
      <div className="splash-intro__below">
        <h1 className="splash-intro__name">دفتر البقالة</h1>
        <p className="splash-intro__tag">ديونك ودفعاتك، في دفتر واحد</p>
        <div className="splash-intro__bar"><span /></div>
      </div>

      <div className="splash-intro__book">
        <header>دفتر الديون</header>
        <div className="splash-intro__row"><span>محمد</span><b className="credit">100 ريال سعودي له</b></div>
        <div className="splash-intro__row"><span>فاطمة</span><b className="settled">مسدد</b></div>
        <div className="splash-intro__row"><span>علي</span><b className="credit">3,000 ريال له</b></div>
      </div>
    </div>
  );
};

export default SplashIntro;
