import { IonToolbar, IonButton, IonIcon } from '@ionic/react';
import { bookOutline, storefrontOutline } from 'ionicons/icons';
import { useLocation } from 'react-router-dom';
import { POS_ENABLED } from '../../config';
import { useAuth } from '../../lib/auth';

/** Who may use the point-of-sale section: the owner, and any account he
 *  switched it on for in the Watcher — and only in a build that ships it. */
export function usePosAccess(): boolean {
  const { isOwner, posAllowed } = useAuth();
  return POS_ENABLED && (isOwner || posAllowed);
}

/**
 * The switch between the app's sections — «الديون» and «نقطة البيع». Shown at
 * the bottom of each section's main screen, and ONLY to an account allowed
 * both; everyone else sees no bar and the app is exactly as it was.
 */
const SectionBar: React.FC = () => {
  const allowed = usePosAccess();
  const { pathname } = useLocation();
  if (!allowed) return null;
  const inPos = pathname.startsWith('/pos');
  return (
    <IonToolbar>
      <div style={{ display: 'flex' }}>
        <IonButton
          style={{ flex: 1 }} fill={inPos ? 'clear' : 'solid'}
          routerLink="/home" routerDirection="root"
        >
          <IonIcon slot="start" icon={bookOutline} />
          الديون
        </IonButton>
        <IonButton
          style={{ flex: 1 }} fill={inPos ? 'solid' : 'clear'}
          routerLink="/pos/today" routerDirection="root"
        >
          <IonIcon slot="start" icon={storefrontOutline} />
          نقطة البيع
        </IonButton>
      </div>
    </IonToolbar>
  );
};

export default SectionBar;
