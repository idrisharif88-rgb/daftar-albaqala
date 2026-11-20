import { useEffect, useState } from 'react';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonItem, IonLabel, IonInput, IonSelect, IonSelectOption, IonNote,
} from '@ionic/react';
import { createItem, type Item } from '../data/items';
import { toMinor } from '../data/money';
import { CURRENCIES, currencyDef, type CurrencyCode } from '../data/currencies';
import { numericInput } from '../lib/digits';

// «+ صنف جديد» from inside an invoice: a missing item is added to the price
// list WITHOUT leaving the invoice, so the basket built so far stays put.
// Before this, the owner had to back out (losing the basket), add the item on
// the price-list screen, and start the invoice again.
//
// When the basket already has lines, the currency is fixed to the invoice's:
// one invoice is one currency, and a new item in another would empty it.

interface Props {
  open: boolean;
  customerId: string;
  /** Filled from the search box, so typing «زيت» then tapping add needs no retyping. */
  initialName: string;
  /** Set when the basket is not empty: the new item must use it. */
  lockedCurrency: CurrencyCode | null;
  defaultCurrency: CurrencyCode;
  onClose: () => void;
  onAdded: (item: Item) => void;
}

const QuickAddItem: React.FC<Props> = ({
  open, customerId, initialName, lockedCurrency, defaultCurrency, onClose, onAdded,
}) => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName.trim());
    setPrice('');
    setCurrency(lockedCurrency ?? defaultCurrency);
    setError(null);
  }, [open, initialName, lockedCurrency, defaultCurrency]);

  const save = async () => {
    if (saving) return;
    const major = Number(price);
    if (!name.trim()) { setError('اسم الصنف مطلوب'); return; }
    if (!price.trim() || Number.isNaN(major) || major < 0) { setError('أدخل سعراً صحيحاً'); return; }
    setSaving(true);
    try {
      const item = await createItem({ customerId, name, price: toMinor(major), currency });
      onAdded(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <IonModal isOpen={open} onDidDismiss={onClose} initialBreakpoint={0.75} breakpoints={[0, 0.75, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>صنف جديد</IonTitle>
          <IonButtons slot="end"><IonButton onClick={onClose}>إلغاء</IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonItem>
          <IonLabel position="stacked">اسم الصنف</IonLabel>
          <IonInput value={name} placeholder="مثال: سكر" onIonInput={(e) => setName(e.detail.value ?? '')} />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">السعر</IonLabel>
          <IonInput
            type="text" inputmode="decimal" value={price} placeholder="0"
            onIonInput={(e) => setPrice(numericInput(e.detail.value ?? ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          />
        </IonItem>
        <IonItem>
          <IonLabel>العملة</IonLabel>
          {lockedCurrency ? (
            <IonNote slot="end">{currencyDef(lockedCurrency).longAr}</IonNote>
          ) : (
            <IonSelect value={currency} interface="popover" onIonChange={(e) => setCurrency(e.detail.value as CurrencyCode)}>
              {CURRENCIES.map((c) => <IonSelectOption key={c.code} value={c.code}>{c.longAr}</IonSelectOption>)}
            </IonSelect>
          )}
        </IonItem>
        {lockedCurrency && (
          <IonNote color="medium" className="quick-add__hint">بعملة الفاتورة الحالية.</IonNote>
        )}
        {error && <IonNote color="danger" className="quick-add__hint">{error}</IonNote>}
        <IonButton expand="block" className="ion-margin-top" disabled={saving} onClick={() => void save()}>
          حفظ وإضافة إلى الفاتورة
        </IonButton>
      </IonContent>
    </IonModal>
  );
};

export default QuickAddItem;
