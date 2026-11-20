import { useState } from 'react';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonPage, IonTitle, IonToolbar, useIonViewWillEnter,
} from '@ionic/react';
import { barbellOutline, settingsOutline } from 'ionicons/icons';
import { useAuth } from '../../lib/auth';
import { getSettings } from '../../data/settings';
import WelcomeCard from '../../components/WelcomeCard';

// «دفتر النادي» — the first page of an account the developer set to «نادٍ
// رياضي» in the Watcher (Phase 43, step 1c). For now it only shows the club is
// recognised; subscribers, packages and renewals arrive in steps 3–4.

const ClubHome: React.FC = () => {
  const { logout } = useAuth();
  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');

  useIonViewWillEnter(() => {
    void getSettings().then((s) => { setStoreName(s.storeName.trim()); setOwnerName(s.ownerName.trim()); });
  });

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{storeName || 'دفتر النادي'}</IonTitle>
          <IonButtons slot="start">
            <IonButton routerLink="/settings" aria-label="الإعدادات">
              <IonIcon slot="icon-only" icon={settingsOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton onClick={logout}>خروج</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <WelcomeCard name={ownerName} storeName={storeName} />
        <div className="club-soon">
          <IonIcon icon={barbellOutline} className="club-soon__icon" aria-hidden="true" />
          <h2>دفتر النادي</h2>
          <p>قريباً: المشتركون، الباقات، التجديد والتذكير.</p>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ClubHome;
