import { IonToolbar } from '@ionic/react';
import IconButton from './IconButton';
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
        <IconButton name="debts" style={{ flex: 1 }} active={!inPos} routerLink="/home" />
        <IconButton name="pos" style={{ flex: 1 }} active={inPos} routerLink="/pos/today" />
      </div>
    </IonToolbar>
  );
};

export default SectionBar;
