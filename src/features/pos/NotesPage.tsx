import { useCallback, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonList, IonItem, IonLabel, IonText,
  IonButton, IonIcon, IonTextarea, IonFooter, IonNote, useIonViewWillEnter, useIonAlert,
} from '@ionic/react';
import { sendOutline, timeOutline } from 'ionicons/icons';
import PosFooter from './PosFooter';
import { ICONS } from './icons';
import { NOTE_MAX, addNote, deleteNote, listNotes, type PosNote } from './notes';
import { useAuth } from '../../lib/auth';

// «الملاحظات» — the shop's notes, newest first. Everyone allowed here can
// write; only the owner can delete (a staff member's delete would be refused
// by the server, so it is not offered). A note shows a clock until the server
// has it — that is also when its author's name arrives.

const when = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const NotesPage: React.FC = () => {
  const { staff } = useAuth();
  const [notes, setNotes] = useState<PosNote[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [presentAlert] = useIonAlert();

  const load = useCallback(async () => { setNotes(await listNotes()); }, []);
  useIonViewWillEnter(() => { void load(); });

  const author = (n: PosNote): string => {
    if (n.pending) return staff ? staff.name : 'صاحب المتجر'; // written here; the server signs it on sync
    return n.authorStaffId ? (n.authorName || 'موظف') : 'صاحب المتجر';
  };

  const send = async () => {
    setError(null);
    try {
      await addNote(draft);
      setDraft('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    }
  };

  const remove = (n: PosNote) => {
    presentAlert({
      header: 'حذف الملاحظة',
      message: 'تُحذف من كل الأجهزة. متأكد؟',
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        { text: 'حذف', role: 'destructive', handler: () => { void deleteNote(n.id).then(load); } },
      ],
    });
  };

  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>الملاحظات</IonTitle></IonToolbar></IonHeader>
      <IonContent>
        {notes.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">لا توجد ملاحظات بعد.</p>
          </IonText>
        ) : (
          <IonList>
            {notes.map((n) => (
              <IonItem key={n.id}>
                <IonLabel className="ion-text-wrap">
                  <p style={{ fontWeight: 700 }}>
                    {author(n)} · <span dir="ltr">{when(n.createdAt)}</span>
                    {n.pending && <IonIcon icon={timeOutline} aria-label="لم تُرفع بعد" style={{ marginInlineStart: 6 }} />}
                  </p>
                  <h2 style={{ whiteSpace: 'pre-wrap', fontSize: '1.1rem' }}>{n.body}</h2>
                </IonLabel>
                {!staff && (
                  <IonButton slot="end" fill="clear" color="danger" aria-label="حذف الملاحظة" onClick={() => remove(n)}>
                    <IonIcon slot="icon-only" icon={ICONS.trash} />
                  </IonButton>
                )}
              </IonItem>
            ))}
          </IonList>
        )}
      </IonContent>
      <IonFooter>
        <IonToolbar>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: '4px 8px' }}>
            <IonTextarea
              value={draft} autoGrow rows={1} maxlength={NOTE_MAX} placeholder="اكتب ملاحظة…"
              onIonInput={(e) => setDraft(e.detail.value ?? '')}
              style={{ flex: 1 }}
            />
            <IonButton aria-label="إرسال" disabled={!draft.trim()} onClick={() => { void send(); }}>
              <IonIcon slot="icon-only" icon={sendOutline} />
            </IonButton>
          </div>
          {error && <IonNote color="danger" className="ion-padding-start">{error}</IonNote>}
        </IonToolbar>
      </IonFooter>
      <PosFooter />
    </IonPage>
  );
};

export default NotesPage;
