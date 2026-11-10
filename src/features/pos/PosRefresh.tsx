import { useCallback, useRef, useState } from 'react';
import { IonButton, IonIcon, IonRefresher, IonRefresherContent, IonSpinner, useIonToast } from '@ionic/react';
import { ICONS, ICON_LABELS } from './icons';
import { runPosSync } from './posSync';
import { useAuth } from '../../lib/auth';

// One refresh for every POS screen: the refresh icon in the header and the
// pull-down gesture do the same thing —
//   1. re-read what this account may do (a staff member's permissions and
//      tabs, the shop's switches) — so a change made by the owner applies now;
//   2. sync the POS data (products added on another phone, today's stock);
//   3. redraw the screen.
// Offline it still redraws from the phone, and says so.

export function usePosRefresh(reload: () => Promise<unknown> | unknown) {
  const { refreshAccess } = useAuth();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [presentToast] = useIonToast();
  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const [, outcome] = await Promise.all([refreshAccess(), runPosSync()]);
      await reload();
      if (outcome.status === 'offline') {
        void presentToast({ message: 'لا يوجد اتصال بالإنترنت. البيانات من الجهاز.', duration: 2000, color: 'medium' });
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [refreshAccess, reload, presentToast]);
  return { busy, run };
}

/** Pull-down-to-refresh. Place first inside the page's IonContent. */
export const PosRefresher: React.FC<{ onRefresh: () => Promise<void> }> = ({ onRefresh }) => (
  <IonRefresher slot="fixed" onIonRefresh={(e) => { void onRefresh().finally(() => e.detail.complete()); }}>
    <IonRefresherContent pullingText="اسحب للتحديث" refreshingSpinner="crescent" refreshingText="جارٍ التحديث…" />
  </IonRefresher>
);

/** The header's refresh icon. */
export const RefreshButton: React.FC<{ busy: boolean; onClick: () => void }> = ({ busy, onClick }) => (
  <IonButton aria-label={ICON_LABELS.refresh} disabled={busy} onClick={onClick}>
    {busy ? <IonSpinner name="crescent" /> : <IonIcon slot="icon-only" icon={ICONS.refresh} />}
  </IonButton>
);
