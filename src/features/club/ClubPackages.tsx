import { useCallback, useState } from 'react';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonInput,
  IonItem, IonList, IonModal, IonNote, IonPage, IonTitle, IonToolbar, useIonAlert, useIonViewWillEnter,
} from '@ionic/react';
import { add } from 'ionicons/icons';
import { formatMinor, toMinor } from '../../data/money';
import { runSync } from '../../data/sync';
import { numericInput } from '../../lib/digits';
import { deletePackage, listPackages, savePackage, type ClubPackage } from './packages';

// The club's packages: name, number of days, price (Phase 43, step 3). The
// price is the LIST price — a subscriber can be sold one for less.

const ClubPackages: React.FC = () => {
  const [list, setList] = useState<ClubPackage[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [name, setName] = useState('');
  const [days, setDays] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [presentAlert] = useIonAlert();

  const load = useCallback(async () => { setList(await listPackages()); }, []);
  useIonViewWillEnter(() => { void load(); });

  const edit = (p?: ClubPackage) => {
    setEditId(p?.id);
    setName(p?.name ?? '');
    setDays(p ? String(p.days) : '');
    setPrice(p ? String(p.price / 100) : '');
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    try {
      await savePackage({ id: editId, name, days: Number(days), price: toMinor(Number(price)) });
      setOpen(false);
      void runSync();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الحفظ');
    }
  };

  const remove = () => {
    if (!editId) return;
    presentAlert({
      header: 'حذف الباقة',
      message: `حذف «${name}»؟ الاشتراكات المسجلة بها تبقى كما هي.`,
      buttons: [
        { text: 'رجوع', role: 'cancel' },
        {
          text: 'حذف', role: 'destructive',
          handler: () => { void deletePackage(editId).then(() => { setOpen(false); void runSync(); return load(); }); },
        },
      ],
    });
  };

  return (
    <IonPage className="club">
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/club" text="رجوع" /></IonButtons>
          <IonTitle>الباقات</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {list.length === 0 ? (
          <p className="club-empty">لا توجد باقات. أضف «شهري» أو «أسبوعي» أو «يومي» بالزر ➕</p>
        ) : (
          <div className="club-list club-list--top">
            {list.map((p) => (
              <IonItem key={p.id} button detail={false} lines="none" className="club-row" onClick={() => edit(p)}>
                <div className="club-row__tx">
                  <b>{p.name}</b>
                  <span>{p.days === 1 ? 'يوم واحد' : `${p.days} يوماً`}</span>
                </div>
                <span slot="end" className="club-price">{formatMinor(p.price)} ر.ي</span>
              </IonItem>
            ))}
          </div>
        )}

        <IonFab vertical="bottom" horizontal="start" slot="fixed">
          <IonFabButton className="club-fab" aria-label="باقة جديدة" onClick={() => edit()}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

        <IonModal className="club-sheet" isOpen={open} onDidDismiss={() => setOpen(false)} initialBreakpoint={0.6} breakpoints={[0, 0.6, 1]}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{editId ? 'تعديل الباقة' : 'باقة جديدة'}</IonTitle>
              <IonButtons slot="end"><IonButton onClick={() => setOpen(false)}>إلغاء</IonButton></IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonList>
              <IonItem>
                <IonInput label="الاسم" labelPlacement="stacked" value={name} placeholder="مثال: شهري"
                  onIonInput={(e) => setName(e.detail.value ?? '')} />
              </IonItem>
              <div className="club-two">
                <IonItem>
                <IonInput label="عدد الأيام" labelPlacement="stacked" type="text" inputmode="numeric" value={days}
                  placeholder="30" onIonInput={(e) => setDays(numericInput(e.detail.value ?? '').replace('.', ''))} />
                </IonItem>
                <IonItem>
                <IonInput label="السعر (ر.ي)" labelPlacement="stacked" type="text" inputmode="decimal" value={price}
                  placeholder="10000" onIonInput={(e) => setPrice(numericInput(e.detail.value ?? ''))} />
                </IonItem>
              </div>
            </IonList>
            {error && <IonNote color="danger" className="club-err">{error}</IonNote>}
            <IonButton expand="block" className="club-btn ion-margin-top"
              disabled={!name.trim() || !days || !price} onClick={() => void save()}>حفظ</IonButton>
            {editId && <IonButton expand="block" fill="clear" color="danger" onClick={remove}>حذف الباقة</IonButton>}
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default ClubPackages;
