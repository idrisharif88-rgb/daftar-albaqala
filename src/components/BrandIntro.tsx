import { useEffect, useRef, useState } from 'react';
import { BRAND_LOGO_EVENT, clearIntroPending, introPending, useBrandLogo } from '../lib/brandLogo';
import { getSettings } from '../data/settings';
import { greeting } from '../data/welcome';

// The shop's intro picture (its whole card), full-screen ONCE after sign-in:
// it grows in with a pulse, a light passes over it, the greeting rises, and
// after 2.5 s it is gone. One tap skips it. Only accounts the
// developer gave an intro picture (Watcher) ever see this — approved by the
// owner from the preview on 2026-11-20.
//
// The picture may arrive a moment AFTER sign-in (/me → download); the
// pending mark lasts a few seconds for it (lib/brandLogo.ts).

const PLAY_MS = 2500;

const BrandIntro: React.FC = () => {
  // Its own intro picture, else the shop's logo: one picture is enough to
  // play it (owner, 2026-11-20 — he set only one and expected the intro).
  const ownIntro = useBrandLogo('intro');
  const logo = useBrandLogo('logo');
  const intro = ownIntro ?? logo;
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  // The animation starts only once the picture is decoded, so a slow decode
  // never eats into the 3 s (it once looked like it 'played for under a second').
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const check = () => {
      if (!introPending() || !intro || show) return;
      clearIntroPending(); // once per sign-in, even if the app is closed mid-way
      void getSettings().then((s) => setName(s.ownerName.trim() || s.storeName.trim()));
      setReady(false);
      setShow(true);
    };
    check();
    window.addEventListener(BRAND_LOGO_EVENT, check);
    return () => window.removeEventListener(BRAND_LOGO_EVENT, check);
  }, [intro, show]);

  useEffect(() => {
    if (!show || !ready) return undefined;
    timer.current = setTimeout(() => setShow(false), PLAY_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [show, ready]);

  if (!show || !intro) return null;
  return (
    <div className={`brand-intro${ready ? ' brand-intro--play' : ''}`} role="presentation" onClick={() => setShow(false)}>
      <div className="brand-intro__ring" />
      <div className="brand-intro__card">
        <img src={intro} alt="" onLoad={() => setReady(true)} onError={() => setShow(false)} />
        <div className="brand-intro__shine" />
      </div>
      <div className="brand-intro__hello">{greeting()}{name ? `، ${name}` : ''} 👋</div>
    </div>
  );
};

export default BrandIntro;
