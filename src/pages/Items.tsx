import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonText, IonSpinner, IonModal,
  IonInput, IonNote, IonSearchbar, IonIcon, IonFab, IonFabButton,
  IonItemSliding, IonItemOptions, IonItemOption,
  IonSelect, IonSelectOption, useIonViewWillEnter, useIonAlert,
} from '@ionic/react';
import { add, trashOutline, createOutline } from 'ionicons/icons';
import { getCustomer, type Customer } from '../data/customers';
import {
  listItems, createItem, updateItem, deleteItem, type Item,
} from '../data/items';
import { toMinor, fromMinor } from '../data/money';
import { runSync } from '../data/sync';
import {
  BASE_CURRENCY, CURRENCIES, formatAmount, type CurrencyCode,
} from '../data/currencies';
import { isAccountActive, INACTIVE_MESSAGE } from '../data/account';

// The price list for ONE contact — «أصناف متجر ماجد».
//
// This is a price list, not a stock list. Nothing here counts what is on a
// shelf: the owner of this book is the one BUYING. The price is simply the last
// price paid, kept so that recording the same purchase again is a tap instead
// of a sum, and so an invoice can be built from taps.
const Items: React.FC = () => {
  const { id: customerId } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const modal = useRef<HTMLIonModalElement>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(BASE_CURRENCY);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [presentAlert] = useIonAlert();

  const load = useCallback(async () => {
    const [c, list] = await Promise.all([getCustomer(customerId), listItems(customerId)]);
    setCustomer(c);
    setItems(list);
    setLoading(false);
  }, [customerId]);

  useIonViewWillEnter(() => { void load(); });

  const openForm = async (item: Item | null) => {
    if (!(await isAccountActive())) {
      presentAlert({ header: 'حساب غير مفعّل', message: INACTIVE_MESSAGE, buttons: ['حسناً'] });
      return;
    }
    setEditing(item);
    setName(item?.name ?? '');
    // Shown in MAJOR units — the owner types 1500, the store keeps 150000.
    setPrice(item ? String(fromMinor(item.price)) : '');
    setCurrency(item?.currency ?? BASE_CURRENCY);
    setNote(item?.note ?? '');
    setError(null);
    void modal.current?.present();
  };

  const save = async () => {
    setError(null);
    const major = Number(price.replace(',', '.'));
    if (!name.trim()) { setError('اسم الصنف مطلوب'); return; }
    if (!price.trim() || Number.isNaN(major) || major < 0) {
      setError('أدخل سعراً صحيحاً');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateItem(editing.id, {
          name, price: toMinor(major), currency, note: note.trim() || null,
        });
      } else {
        await createItem({
          customerId, name, price: toMinor(major), currency, note: note.trim() || null,
        });
      }
      await load();
      void runSync(); // fire-and-forget; the list belongs to the account
      await modal.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (item: Item) => {
    presentAlert({
      header: 'حذف الصنف',
      message: `حذف «${item.name}» من قائمة الأسعار؟ الحركات المسجّلة سابقاً لا تتأثر.`,
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'حذف',
          role: 'destructive',
          handler: () => {
            void (async () => {
              await deleteItem(item.id);
              await load();
              void runSync();
            })();
          },
        },
      ],
    });
  };

  const term = search.trim().toLowerCase();
  const visible = term
    ? items.filter((i) => i.name.toLowerCase().includes(term))
    : items;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref={`/customers/${customerId}`} text="رجوع" />
          </IonButtons>
          <IonTitle>{customer ? `أصناف ${customer.name}` : 'الأصناف'}</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSearchbar
            value={search}
            onIonInput={(e) => setSearch(e.detail.value ?? '')}
            placeholder="بحث عن صنف"
          />
        </IonToolbar>
      </IonHeader>

      <IonContent>
        {loading ? (
          <div className="ion-text-center ion-padding">
            <IonSpinner name="crescent" />
          </div>
        ) : items.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">
              لا توجد أصناف بعد. أضف أول صنف بالزر بالأسفل ➕
            </p>
          </IonText>
        ) : visible.length === 0 ? (
          // The wording the owner asked for: searching for something that was
          // never entered has to SAY so, not show an empty screen that looks
          // like the list failed to load.
          <IonText color="medium">
            <p className="ion-text-center ion-padding">الصنف غير مسجل</p>
          </IonText>
        ) : (
          <IonList>
            {visible.map((item) => (
              <IonItemSliding key={item.id}>
                <IonItem button onClick={() => openForm(item)}>
                  <IonLabel>
                    <h2>{item.name}</h2>
                    {item.note && <p>{item.note}</p>}
                  </IonLabel>
                  <IonText slot="end">
                    <strong>{formatAmount(item.price, item.currency)}</strong>
                  </IonText>
                </IonItem>
                {/* Swipe for the destructive action — a delete button sitting
                    permanently next to every row is a delete waiting to be
                    tapped by accident. */}
                <IonItemOptions side="end">
                  <IonItemOption onClick={() => openForm(item)}>
                    <IonIcon slot="icon-only" icon={createOutline} />
                  </IonItemOption>
                  <IonItemOption color="danger" onClick={() => confirmDelete(item)}>
                    <IonIcon slot="icon-only" icon={trashOutline} />
                  </IonItemOption>
                </IonItemOptions>
              </IonItemSliding>
            ))}
          </IonList>
        )}

        <IonFab slot="fixed" vertical="bottom" horizontal="start">
          <IonFabButton onClick={() => { void openForm(null); }}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

        <IonModal ref={modal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{editing ? 'تعديل صنف' : 'صنف جديد'}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => modal.current?.dismiss()}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">اسم الصنف</IonLabel>
              <IonInput
                value={name}
                onIonInput={(e) => setName(e.detail.value ?? '')}
                placeholder="مثال: سكر"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">السعر</IonLabel>
              <IonInput
                type="number"
                inputmode="decimal"
                value={price}
                onIonInput={(e) => setPrice(e.detail.value ?? '')}
                placeholder="0"
              />
            </IonItem>
            <IonItem>
              <IonLabel>العملة</IonLabel>
              <IonSelect
                value={currency}
                onIonChange={(e) => setCurrency(e.detail.value as CurrencyCode)}
                interface="popover"
              >
                {CURRENCIES.map((c) => (
                  <IonSelectOption key={c.code} value={c.code}>{c.longAr}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">ملاحظة (اختياري)</IonLabel>
              <IonInput value={note} onIonInput={(e) => setNote(e.detail.value ?? '')} />
            </IonItem>

            {error && (
              <IonNote color="danger" className="ion-padding-start">
                <IonText>{error}</IonText>
              </IonNote>
            )}

            <IonButton expand="block" onClick={save} disabled={saving} className="ion-margin-top">
              {saving ? <IonSpinner name="crescent" /> : 'حفظ'}
            </IonButton>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Items;
