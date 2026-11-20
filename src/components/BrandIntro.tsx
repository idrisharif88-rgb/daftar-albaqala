import { useEffect, useRef, useState } from 'react';
import { BRAND_LOGO_EVENT, clearIntroPending, introMarkedAt, introPending, useBrandLogo } from '../lib/brandLogo';
import { getSettings } from '../data/settings';
import { greeting } from '../data/welcome';
import { GATE_EVENT, gateUnlockedAt, isGateLocked } from '../lib/gateState';
import { biometricEnabled } from '../lib/biometric';
import { fixedIntroFor } from '../config';
import { getPhone } from '../lib/storage';

// The shop's intro picture (its whole card), full-screen ONCE after sign-in:
// it grows in with a pulse, a light passes over it, the greeting rises, and
// after 3 s it is gone. One tap skips it. Only accounts the
// developer gave an intro picture (Watcher) ever see this — approved by the
// owner from the preview on 2026-11-20.
//
// The picture may arrive a moment AFTER sign-in (/me → download); the
// pending mark lasts a few seconds for it (lib/brandLogo.ts).

const PLAY_MS = 3000;

const BrandIntro: React.FC = () => {
  // Its own intro picture, else the shop's logo: one picture is enough to
  // play it (owner, 2026-11-20 — he set only one and expected the intro).
  // A picture built into the app for this account (config.ts) comes first,
  // then the Watcher's intro picture, then the shop's logo.
  const ownIntro = useBrandLogo('intro');
  const logo = useBrandLogo('logo');
  const fixed = fixedIntroFor(getPhone());
  const intro = fixed ?? ownIntro ?? logo;
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  // The animation starts only once the picture is decoded, so a slow decode
  // never eats into the 3 s (it once looked like it 'played for under a second').
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const check = () => {
      if (!introPending() || !intro || show) return;
      // With the fingerprint lock on, sign-in raises it: play only once it has
      // lifted AFTER this sign-in, or the intro runs hidden behind it.
      if (isGateLocked() || (biometricEnabled() && gateUnlockedAt() < introMarkedAt())) return;
      clearIntroPending(); // once per sign-in, even if the app is closed mid-way
      void getSettings().then((s) => setName(s.ownerName.trim() || s.storeName.trim()));
      setReady(false);
      setShow(true);
    };
    check();
    window.addEventListener(BRAND_LOGO_EVENT, check);
    window.addEventListener(GATE_EVENT, check);
    return () => {
      window.removeEventListener(BRAND_LOGO_EVENT, check);
      window.removeEventListener(GATE_EVENT, check);
    };
  }, [intro, show]);

  // Exactly PLAY_MS on screen, counted from the moment it appears — which is
  // right after sign-in, or right after the fingerprint unlock when the lock
  // is on. The CSS fade ends at the same moment (variables.css, 2.6 s + 0.4 s).
  useEffect(() => {
    if (!show) return undefined;
    timer.current = setTimeout(() => setShow(false), PLAY_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [show]);

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
