import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonText,
} from '@ionic/react';
import { useAuth } from '../lib/auth';

// Placeholder home for a signed-in shopkeeper. The customer list + balances
// land here in the next Phase 6 slice; for now it just confirms auth works and
// offers logout.
const Home: React.FC = () => {
  const { user, logout } = useAuth();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{user?.store_name || 'دفتر البقالة'}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={logout}>خروج</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonText>
          <h2>أهلاً بك 👋</h2>
          <p>تم تسجيل الدخول بنجاح. قائمة العملاء ستظهر هنا قريباً.</p>
          {user?.phone && <p>{user.phone}</p>}
        </IonText>
      </IonContent>
    </IonPage>
  );
};

export default Home;
