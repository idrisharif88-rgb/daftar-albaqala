import { useCallback, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonList, IonItem, IonLabel, IonText,
  IonButton, IonIcon, IonTextarea, IonFooter, IonNote, useIonViewWillEnter, useIonAlert,
} from '@ionic/react';
import { createOutline, sendOutline, shareSocialOutline, timeOutline } from 'ionicons/icons';
import { Share } from '@capacitor/share';
import PosFooter from './PosFooter';
import { ICONS } from './icons';
import { NOTE_MAX, addNote, deleteNote, editNote, listNotes, type PosNote } from './notes';
import { useAuth } from '../../lib/auth';
import { PosRefresher, RefreshButton, usePosRefresh } from './PosRefresh';

// «الملاحظات» — the shop's notes, newest first. Everyone allowed here can
// write and share any note; a note is edited or deleted by whoever wrote it,
// or by the owner (the server refuses anyone else, so it is not offered). A
// note shows a clock until the server has it — that is also when its author's
// name arrives.

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
  const pull = usePosRefresh(load);

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

  /** The owner, or the member who wrote it (a note still on this phone is ours). */
  const mayChange = (n: PosNote) =>
    !staff || n.authorStaffId === staff.id || (n.pending && n.authorStaffId === null && !n.authorName);

  const edit = (n: PosNote) => {
    presentAlert({
      header: 'تعديل الملاحظة',
      inputs: [{ name: 'body', type: 'textarea', value: n.body, attributes: { maxlength: NOTE_MAX } }],
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'حفظ',
          handler: (v: { body?: string }) => {
            void editNote(n.id, v.body ?? '').then(load).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : 'حدث خطأ');
            });
          },
        },
      ],
    });
  };

  const share = async (n: PosNote) => {
    const text = `${n.body}\n— ${author(n)} · ${when(n.createdAt)}`;
    try {
      await Share.share({ text, dialogTitle: 'مشاركة الملاحظة' });
    } catch {
      // cancelled, or no share on this platform — copy instead
      try { await navigator.clipboard.writeText(text); } catch { /* nothing more to do */ }
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
      <IonHeader>
        <IonToolbar>
          <IonTitle>الملاحظات</IonTitle>
          <IonButtons slot="end"><RefreshButton busy={pull.busy} onClick={() => { void pull.run(); }} /></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <PosRefresher onRefresh={pull.run} />
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
                  {n.editedAt && <p style={{ fontSize: '.8rem' }}>(معدّلة)</p>}
                </IonLabel>
                <IonButton slot="end" fill="clear" aria-label="مشاركة الملاحظة" onClick={() => { void share(n); }}>
                  <IonIcon slot="icon-only" icon={shareSocialOutline} />
                </IonButton>
                {mayChange(n) && (
                  <>
                    <IonButton slot="end" fill="clear" aria-label="تعديل الملاحظة" onClick={() => edit(n)}>
                      <IonIcon slot="icon-only" icon={createOutline} />
                    </IonButton>
                    <IonButton slot="end" fill="clear" color="danger" aria-label="حذف الملاحظة" onClick={() => remove(n)}>
                      <IonIcon slot="icon-only" icon={ICONS.trash} />
                    </IonButton>
                  </>
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
