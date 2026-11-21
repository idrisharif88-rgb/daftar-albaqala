import { useCallback, useEffect, useState } from 'react';
import LineIcon from '../../components/LineIcon';
import { useAuth } from '../../lib/auth';
import { getMeta, setMeta } from '../../data/meta';
import { onSyncComplete, runSync } from '../../data/sync';
import { GATE_EVENT, isGateLocked, isIntroPlaying } from '../../lib/gateState';
import { TOURS, tourSeenKey, type TourType } from './tours';

// The tour for this account's type, shown ONCE per account after sign-in
// (Phase 43; design approved 2026-11-20). «ابدأ» and «تخطٍّ» both mark it
// seen in a SYNCED setting, so the owner's other phone does not repeat it.
// It waits for: the fingerprint lock, the shop's intro, and the first sync
// (which brings the "seen" mark from another phone). Settings → «جولة في
// التطبيق» replays it.

export const OPEN_TOUR_EVENT = 'daftar:open-tour';
export const openTour = () => window.dispatchEvent(new Event(OPEN_TOUR_EVENT));

/** Longest wait for the first sync before deciding (an offline phone). */
const SYNC_WAIT_MS = 8000;

const AppTour: React.FC = () => {
  const { isAuthenticated, staff, isClub } = useAuth();
  const type: TourType = isClub ? 'club' : 'grocery';
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false); // first sync done (or gave up waiting)
  const active = isAuthenticated && !staff;

  // Wait for one sync, so a "seen" mark from another phone is here first.
  useEffect(() => {
    if (!active) { setReady(false); setOpen(false); return undefined; }
    let done = false;
    const finish = () => { if (!done) { done = true; setReady(true); } };
    const off = onSyncComplete(finish);
    const t = setTimeout(finish, SYNC_WAIT_MS);
    return () => { off(); clearTimeout(t); };
  }, [active]);

  const maybeShow = useCallback(async () => {
    if (!active || !ready || open) return;
    if (isGateLocked() || isIntroPlaying()) return;
    if ((await getMeta(tourSeenKey(type))) === '1') return;
    if (isGateLocked() || isIntroPlaying()) return;
    setOpen(true);
  }, [active, ready, open, type]);

  useEffect(() => {
    void maybeShow();
    const on = () => { void maybeShow(); };
    window.addEventListener(GATE_EVENT, on);
    return () => window.removeEventListener(GATE_EVENT, on);
  }, [maybeShow]);

  // Settings → «جولة في التطبيق».
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_TOUR_EVENT, on);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, on);
  }, []);

  const close = () => {
    setOpen(false);
    void setMeta(tourSeenKey(type), '1').then(() => { void runSync(); });
  };

  if (!active || !open) return null;
  const tour = TOURS[type];
  return (
    <div className={`tour ${tour.theme}`} role="dialog" aria-modal="true" aria-label={tour.title}>
      <div className="tour__band">
        <span className="tour__pill">{tour.pill}</span>
        <div className="tour__mark"><LineIcon name={tour.icon} /></div>
        <div className="tour__title">{tour.title}</div>
        <div className="tour__tag">{tour.tagline}</div>
      </div>
      <div className="tour__list">
        {tour.items.map((it) => (
          <div className="tour__item" key={it.title}>
            <div className="tour__ic"><LineIcon name={it.icon} /></div>
            <div className="tour__tx"><b>{it.title}</b><span>{it.line}</span></div>
          </div>
        ))}
      </div>
      <div className="tour__bottom">
        <div className="tour__prog" aria-hidden="true"><span className="on" /><span /><span /></div>
        <button type="button" className="tour__btn" onClick={close}>ابدأ</button>
        <button type="button" className="tour__skip" onClick={close}>تخطٍّ</button>
      </div>
    </div>
  );
};

export default AppTour;
