import { useEffect, useState } from 'react';
import './SplashIntro.css';

// The animated opening screen, played once per launch, over everything.
//
// Android's own launch screen is plain brand green now (launch_green.xml), so
// the hand-over from the native window to this one is green to green with
// nothing in between — no white flash, no stock logo.
//
// The fingerprint lock waits for it (whenSplashDone): asking for a finger
// while the basket is still rolling would put Samsung's sheet over the
// animation.

// 2.7s of basket and name (the owner asked for one second more than the first
// cut), then the sample book held for about a second before the real app.
const SHOW_MS = 4000;
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

// Once per launch: a hot reload or a remount must not replay it.
let played = false;

const SplashIntro: React.FC = () => {
  const [phase, setPhase] = useState<'showing' | 'leaving' | 'gone'>(
    played ? 'gone' : 'showing',
  );

  useEffect(() => {
    // The plain green placeholder in index.html has done its job.
    document.getElementById('boot-splash')?.remove();
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
      <div className="splash-intro__tile">
        <svg viewBox="0 0 64 64" fill="none">
          <path d="M8 12h7l6 28h28l6-20H18" stroke="#ffffff" strokeWidth="5"
            strokeLinecap="round" strokeLinejoin="round" />
          <circle className="splash-intro__wheel" cx="25" cy="50" r="4.5" fill="#ffffff" />
          <circle className="splash-intro__wheel" cx="45" cy="50" r="4.5" fill="#ffffff" />
        </svg>
      </div>
      <h1 className="splash-intro__name">دفتر البقالة</h1>
      <p className="splash-intro__tag">ديونك ودفعاتك، في دفتر واحد</p>
      <div className="splash-intro__bar"><span /></div>

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
