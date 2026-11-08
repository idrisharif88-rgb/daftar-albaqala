import { IonFooter, IonToolbar, IonButton } from '@ionic/react';
import { useLocation } from 'react-router-dom';
import SectionBar from './SectionBar';

const TABS = [
  { path: '/pos/today', label: 'اليوم' },
  { path: '/pos/sell', label: 'بيع' },
  { path: '/pos/history', label: 'السجل' },
  { path: '/pos/products', label: 'المنتجات' },
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
            <IonButton
              key={t.path} style={{ flex: 1 }} size="small"
              fill={pathname === t.path ? 'solid' : 'clear'}
              routerLink={t.path} routerDirection="root"
            >
              {t.label}
            </IonButton>
          ))}
        </div>
      </IonToolbar>
      <SectionBar />
    </IonFooter>
  );
};

export default PosFooter;
