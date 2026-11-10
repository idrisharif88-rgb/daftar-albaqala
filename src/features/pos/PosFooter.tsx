import { IonFooter, IonToolbar } from '@ionic/react';
import IconButton from './IconButton';
import type { IconName } from './icons';
import { useLocation } from 'react-router-dom';
import SectionBar from './SectionBar';
import { useAuth } from '../../lib/auth';
import { usePosPermissions, type Permission } from './permissions';

export interface PosTab { path: string; icon: IconName }

/** The POS tabs THIS person may open, in order. The owner gets every tab (and
 *  «الموظفون» once the developer switched staff accounts on); a staff member
 *  gets the tabs their permissions call for. The router (App.tsx) uses the
 *  same list, so a tab that is not shown cannot be reached by its address
 *  either. */
export function usePosTabs(): PosTab[] {
  const { staff, posStaffAllowed, posNotesAllowed } = useAuth();
  return posTabsFor(usePosPermissions(), staff !== null, posStaffAllowed, posNotesAllowed);
}

/** The rule itself, without React — so it can be tested. */
export function posTabsFor(
  can: (p: Permission) => boolean, isStaff: boolean, staffFeatureOn: boolean, notesOn = false,
): PosTab[] {
  const tabs: PosTab[] = [];
  if (can('see_stock') || can('add_stock')) tabs.push({ path: '/pos/today', icon: 'today' });
  if (can('sell')) tabs.push({ path: '/pos/sell', icon: 'sell' });
  if (can('see_reports')) tabs.push({ path: '/pos/history', icon: 'history' });
  if (can('manage_products')) tabs.push({ path: '/pos/products', icon: 'products' });
  if (notesOn && can('notes')) tabs.push({ path: '/pos/notes', icon: 'notes' });
  if (isStaff ? can('manage_staff') : staffFeatureOn) tabs.push({ path: '/pos/staff', icon: 'staff' });
  return tabs;
}

export const firstPosTab = (tabs: PosTab[]): string | null => tabs[0]?.path ?? null;

/** The bottom of every POS screen: its tabs, then the switch between the app's
 *  sections (owner) — or, for a staff member, their account page instead. */
const PosFooter: React.FC = () => {
  const { pathname } = useLocation();
  const { staff } = useAuth();
  const tabs = usePosTabs();
  const shown: PosTab[] = staff ? [...tabs, { path: '/pos/account', icon: 'account' }] : tabs;
  return (
    <IonFooter>
      <IonToolbar>
        <div style={{ display: 'flex' }}>
          {shown.map((t) => (
            <IconButton
              key={t.path} name={t.icon} style={{ flex: 1 }}
              active={pathname === t.path} routerLink={t.path}
            />
          ))}
        </div>
      </IonToolbar>
      {!staff && <SectionBar />}
    </IonFooter>
  );
};

export default PosFooter;
