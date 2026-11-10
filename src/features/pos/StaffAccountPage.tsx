import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonList, IonItem, IonLabel, IonButton,
  IonIcon, IonListHeader, IonText, useIonAlert,
} from '@ionic/react';
import { checkmarkOutline, logOutOutline } from 'ionicons/icons';
import PosFooter from './PosFooter';
import { useAuth } from '../../lib/auth';
import { PERMISSION_LABELS, ROLE_LABELS, isPermission, isStaffRole } from './permissions';

// «حسابي» — a staff member's own page: who they are, whose shop, what they may
// do, and the way out. A staff member has no Settings screen (that belongs to
// the owner's ledger), so signing out lives here.
const StaffAccountPage: React.FC = () => {
  const { staff, logout } = useAuth();
  const [presentAlert] = useIonAlert();
  if (!staff) return null;

  const held = staff.permissions.filter(isPermission);
  const confirmLogout = () => {
    presentAlert({
      header: 'تسجيل الخروج',
      message: 'هل تريد تسجيل الخروج؟',
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        { text: 'خروج', role: 'destructive', handler: () => logout() },
      ],
    });
  };

  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>حسابي</IonTitle></IonToolbar></IonHeader>
      <IonContent>
        <IonList>
          <IonItem>
            <IonLabel>
              <h2 style={{ fontWeight: 700 }}>{staff.name}</h2>
              <p>{isStaffRole(staff.role) ? ROLE_LABELS[staff.role] : staff.role}</p>
            </IonLabel>
          </IonItem>
          {staff.store_name && (
            <IonItem>
              <IonLabel>المتجر</IonLabel>
              <IonText slot="end">{staff.store_name}</IonText>
            </IonItem>
          )}

          <IonListHeader><IonLabel>صلاحياتي</IonLabel></IonListHeader>
          {held.length === 0 ? (
            <IonItem lines="none">
              <IonLabel color="medium" className="ion-text-wrap">
                لا توجد صلاحيات بعد. اطلب من صاحب المتجر تفعيلها.
              </IonLabel>
            </IonItem>
          ) : held.map((p) => (
            <IonItem key={p}>
              <IonIcon icon={checkmarkOutline} slot="start" color="success" />
              <IonLabel>{PERMISSION_LABELS[p]}</IonLabel>
            </IonItem>
          ))}
        </IonList>

        <div className="ion-padding">
          <IonButton expand="block" color="danger" fill="outline" onClick={confirmLogout}>
            <IonIcon slot="start" icon={logOutOutline} />
            تسجيل الخروج
          </IonButton>
        </div>
      </IonContent>
      <PosFooter />
    </IonPage>
  );
};

export default StaffAccountPage;
