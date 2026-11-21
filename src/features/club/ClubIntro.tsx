import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import {
  BRAND_LOGO_EVENT, clearIntroPending, introMarkedAt, introPending, markIntroPending, useBrandLogo,
} from '../../lib/brandLogo';
import { GATE_EVENT, gateUnlockedAt, isGateLocked, setIntroPlaying } from '../../lib/gateState';
import { biometricEnabled } from '../../lib/biometric';
import { fixedIntroFor } from '../../config';
import { getPhone } from '../../lib/storage';

// The opening of «دفتر النادي» for EVERY club (Phase 43, item 8; owner's pick
// 2026-11-21): a real 3-second gym clip (Pexels, free licence, no credit
// required — clip 5319754, cut and muted) with «دفتر النادي» only. The
// personal «مرحباً كابتن <name>» comes AFTER it, on the club's home page
// (WelcomeCard), as the owner asked.
//
// When: once after sign-in, and once on the first open after the update for a
// club already signed in — never on every open. A club the developer gave its
// own picture (Watcher / FIXED_INTROS) gets that instead (BrandIntro).
// Waits for the fingerprint lock, like BrandIntro.

const PLAY_MS = 3000;
const SEEN_KEY = 'daftar.club-intro-seen';

function seenFor(phone: string): boolean {
  try { return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]).includes(phone); } catch { return true; }
}
function markSeen(phone: string): void {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
    if (!list.includes(phone)) localStorage.setItem(SEEN_KEY, JSON.stringify([...list, phone]));
  } catch { /* storage blocked: it may play once more, harmless */ }
}

const ClubIntro: React.FC = () => {
  const { isClub, isAuthenticated, staff } = useAuth();
  const phone = getPhone() ?? '';
  // Hooks first, unconditionally — then decide.
  const introPic = useBrandLogo('intro');
  const logoPic = useBrandLogo('logo');
  const ownPicture = introPic ?? logoPic ?? fixedIntroFor(phone);
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = isAuthenticated && !staff && isClub && !ownPicture;

  // A club already signed in when this version arrives: once, on first open.
  useEffect(() => {
    if (active && phone && !seenFor(phone) && !introPending()) markIntroPending();
  }, [active, phone]);

  useEffect(() => {
    const check = () => {
      if (!active || show || !introPending()) return;
      if (isGateLocked() || (biometricEnabled() && gateUnlockedAt() < introMarkedAt())) return;
      clearIntroPending();
      if (phone) markSeen(phone);
      setShow(true);
    };
    check();
    window.addEventListener(BRAND_LOGO_EVENT, check);
    window.addEventListener(GATE_EVENT, check);
    return () => {
      window.removeEventListener(BRAND_LOGO_EVENT, check);
      window.removeEventListener(GATE_EVENT, check);
    };
  }, [active, show, phone]);

  useEffect(() => {
    setIntroPlaying(show);
    if (!show) return undefined;
    timer.current = setTimeout(() => setShow(false), PLAY_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [show]);

  if (!show) return null;
  return (
    <div className="club-intro" role="presentation" onClick={() => setShow(false)}>
      <video
        src="/brand/club-intro.mp4" poster="/brand/club-intro-poster.jpg"
        autoPlay muted playsInline preload="auto"
      />
      <div className="club-intro__shade" />
      <div className="club-intro__title">دفتر النادي</div>
      <div className="club-intro__line"><i /></div>
    </div>
  );
};

export default ClubIntro;
