import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonList, IonItem,
  IonLabel, IonText, IonSpinner,
} from '@ionic/react';
import { ApiError, listShopNotes, type ShopNote } from '../lib/api';
import { dateTime } from '../lib/format';

// «الملاحظات» — every POS note of one shop, newest first, for the developer.
// Read-only: notes are written and corrected in the shop.

const ShopNotes: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [notes, setNotes] = useState<ShopNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listShopNotes(id).then((r) => setNotes(r.notes))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'تعذّر التحميل'));
  }, [id]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/accounts" text="رجوع" /></IonButtons>
          <IonTitle>الملاحظات</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {error ? (
          <IonText color="danger"><p className="ion-text-center ion-padding">{error}</p></IonText>
        ) : notes === null ? (
          <div className="ion-text-center ion-padding"><IonSpinner name="crescent" /></div>
        ) : notes.length === 0 ? (
          <IonText color="medium"><p className="ion-text-center ion-padding">لا توجد ملاحظات.</p></IonText>
        ) : (
          <IonList>
            {notes.map((n) => (
              <IonItem key={n.id}>
                <IonLabel className="ion-text-wrap">
                  <p style={{ fontWeight: 700 }}>
                    {n.author_staff_id ? (n.author_name || 'موظف') : 'صاحب المتجر'} · <span dir="ltr">{dateTime(n.created_at)}</span>
                    {n.edited_at ? ' · (معدّلة)' : ''}
                  </p>
                  <h2 style={{ whiteSpace: 'pre-wrap' }}>{n.body}</h2>
                </IonLabel>
              </IonItem>
            ))}
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

export default ShopNotes;
