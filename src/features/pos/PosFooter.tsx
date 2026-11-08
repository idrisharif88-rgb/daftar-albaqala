import { IonFooter, IonToolbar } from '@ionic/react';
import IconButton from './IconButton';
import type { IconName } from './icons';
import { useLocation } from 'react-router-dom';
import SectionBar from './SectionBar';

const TABS: { path: string; icon: IconName }[] = [
  { path: '/pos/today', icon: 'today' },
  { path: '/pos/sell', icon: 'sell' },
  { path: '/pos/history', icon: 'history' },
  { path: '/pos/products', icon: 'products' },
];

/** The bottom of every POS screen: its own three tabs, then the switch between
 *  the app's sections. */
const PosFooter: React.FC = () => {
  const { pathname } = useLocation();
  return (
    <IonFooter>
      <IonToolbar>
        <div style={{ display: 'flex' }}>
          {TABS.map((t) => (
            <IconButton
              key={t.path} name={t.icon} style={{ flex: 1 }}
              active={pathname === t.path} routerLink={t.path}
            />
          ))}
        </div>
      </IonToolbar>
      <SectionBar />
    </IonFooter>
  );
};

export default PosFooter;
