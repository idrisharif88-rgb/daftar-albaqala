import { useCallback, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonList, IonItem, IonLabel,
  IonText, IonSpinner, IonBadge, IonButton, IonIcon, useIonViewWillEnter, useIonAlert,
} from '@ionic/react';
import { add, remove, lockClosedOutline } from 'ionicons/icons';
import PosFooter from './PosFooter';
import {
  addBaked, getDayRows, localDay, totalsOf, retentionDue, keepForAnotherYear,
  deleteOlderThanYear, getDayLock, lockDay, unlockDay, type DayRow, type DayLock,
} from './stock';
import { formatMinor } from '../../data/money';
import { toLatinDigits } from '../../lib/digits';

// «اليوم» — the day's baking: for every product, how many were baked, how many
// sold, how many are left. Tap a product to add what was just baked.
const TodayPage: React.FC = () => {
  const [rows, setRows] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lock, setLock] = useState<DayLock>({ locked: false, reopened: 0 });
  const [presentAlert] = useIonAlert();
  // A SECOND hook for the delete confirmation: one hook keeps one overlay and
  // silently ignores present() while the previous alert is still closing.
  const [presentConfirm] = useIonAlert();
  // A third one for the submit / reopen questions and for refusals.
  const [presentNote] = useIonAlert();

  const load = useCallback(async () => {
    const [r, l] = await Promise.all([getDayRows(), getDayLock()]);
    setRows(r);
    setLock(l);
    setLoading(false);
  }, []);
  // After a year of saved days the app ASKS what to do with the oldest ones.
  // It never deletes on its own: «keep» asks again in a year, and «delete»
  // needs a second, explicit confirmation.
  const askRetention = useCallback(async () => {
    if (!(await retentionDue())) return;
    presentAlert({
      header: 'بيانات أقدم من سنة',
      message: 'لديك أيام محفوظة منذ أكثر من سنة. هل تريد الاستمرار في حفظها أم حذف ما هو أقدم من سنة؟',
      backdropDismiss: false,
      buttons: [
        { text: 'لاحقاً', role: 'cancel' },
        { text: 'الاستمرار في الحفظ', handler: () => { void keepForAnotherYear(); } },
        {
          text: 'حذف الأقدم من سنة',
          role: 'destructive',
          handler: () => {
            presentConfirm({
              header: 'تأكيد الحذف',
              message: 'سيُحذف نهائياً كل ما هو أقدم من سنة، ولا يمكن استرجاعه. متأكد؟',
              buttons: [
                { text: 'إلغاء', role: 'cancel' },
                { text: 'نعم، احذف', role: 'destructive', handler: () => { void deleteOlderThanYear(); } },
              ],
            });
          },
        },
      ],
    });
  }, [presentAlert, presentConfirm]);

  useIonViewWillEnter(() => { void load().then(askRetention); });

  // + / − change the baked count by one, instantly: the screen updates first
  // and the write follows (a failed write reloads the truth).
  const nudge = (r: DayRow, by: 1 | -1) => {
    setRows((all) => all.map((x) => x.product.id === r.product.id
      ? { ...x, baked: x.baked + by, left: x.left + by } : x));
    addBaked(r.product.id, by).catch((err: unknown) => {
      void load(); // show the truth again
      presentNote({ header: 'لا يمكن التعديل', message: err instanceof Error ? err.message : 'حدث خطأ', buttons: ['حسناً'] });
    });
  };

  // For a big batch: tap the number and type it («أخبزنا 60»).
  const askBaked = (r: DayRow) => {
    presentAlert({
      header: r.product.name,
      message: `مخبوز اليوم: ${r.baked}. كم تضيف؟`,
      inputs: [{ name: 'n', type: 'text', placeholder: 'العدد', attributes: { inputmode: 'numeric' } }],
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'إضافة',
          handler: (v: { n?: string }) => {
            const n = Number(toLatinDigits(String(v.n ?? '')).trim());
            if (!Number.isInteger(n) || n <= 0) return false;
            addBaked(r.product.id, n).then(load).catch((err: unknown) => {
              presentNote({ header: 'لا يمكن التعديل', message: err instanceof Error ? err.message : 'حدث خطأ', buttons: ['حسناً'] });
            });
            return true;
          },
        },
      ],
    });
  };

  const submit = () => {
    presentNote({
      header: 'اعتماد كميات اليوم',
      message: `مجموع المخبوز ${totalsOf(rows).baked}. بعد الاعتماد تُقفل الكميات ويستمر البيع.`,
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'اعتماد',
          handler: () => {
            lockDay().then(load).catch((err: unknown) => {
              presentConfirm({ header: 'تعذّر الاعتماد', message: err instanceof Error ? err.message : 'حدث خطأ', buttons: ['حسناً'] });
            });
          },
        },
      ],
    });
  };

  const reopen = () => {
    presentNote({
      header: 'تعديل الكميات المعتمدة',
      message: 'ستُفتح الكميات للتعديل، ويُسجَّل في السجل أن اليوم عُدِّل بعد الاعتماد. لا يمكن إنقاص المخبوز عن المباع.',
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        { text: 'تعديل', handler: () => { void unlockDay().then(load); } },
      ],
    });
  };

  const t = totalsOf(rows);
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>اليوم <small dir="ltr">{localDay()}</small></IonTitle>
        </IonToolbar>
        {!loading && rows.length > 0 && (
          <IonToolbar>
            <div style={{ display: 'flex', justifyContent: 'space-around', padding: '4px 8px', fontSize: '.9rem' }}>
              <span>مخبوز <b>{t.baked}</b></span>
              <span>مباع <b>{t.sold}</b></span>
              <span>متبقي <b>{t.left}</b></span>
              <span>الإيراد <b>{formatMinor(t.revenue)}</b></span>
            </div>
          </IonToolbar>
        )}
        {!loading && rows.length > 0 && (
          <IonToolbar>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
              {lock.locked ? (
                <>
                  <span><IonIcon icon={lockClosedOutline} /> الكميات معتمدة</span>
                  <IonButton fill="outline" size="small" onClick={reopen}>تعديل</IonButton>
                </>
              ) : (
                <>
                  <span>{lock.reopened > 0 ? 'الكميات مفتوحة للتعديل' : 'الكميات غير معتمدة'}</span>
                  <IonButton size="small" disabled={t.baked <= 0} onClick={submit}>اعتماد الكميات</IonButton>
                </>
              )}
            </div>
          </IonToolbar>
        )}
      </IonHeader>

      <IonContent>
        {loading ? (
          <div className="ion-text-center ion-padding"><IonSpinner name="crescent" /></div>
        ) : rows.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">أضف منتجاتك أولاً من تبويب «المنتجات».</p>
          </IonText>
        ) : (
          <IonList>
            {rows.map((r) => (
              <IonItem key={r.product.id}>
                <IonLabel className="ion-text-wrap">
                  <h2>{r.product.name}</h2>
                  <p>
                    مباع {r.sold} · متبقي{' '}
                    {r.baked > 0 && r.left <= 0
                      ? <IonBadge color="danger">نفد</IonBadge>
                      : <b>{r.left}</b>}
                  </p>
                </IonLabel>
                <div slot="end" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {!lock.locked && (
                    <IonButton
                      fill="outline" shape="round" aria-label="إنقاص"
                      disabled={r.baked <= r.sold} onClick={() => nudge(r, -1)}
                    >
                      <IonIcon slot="icon-only" icon={remove} />
                    </IonButton>
                  )}
                  <button
                    type="button" disabled={lock.locked}
                    onClick={() => askBaked(r)} aria-label="إدخال كمية"
                    style={{
                      minWidth: 44, padding: '8px 4px', font: 'inherit', fontWeight: 700,
                      fontSize: '1.25rem', background: 'transparent', border: 0,
                      color: 'inherit', fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {r.baked}
                  </button>
                  {!lock.locked && (
                    <IonButton shape="round" aria-label="زيادة" onClick={() => nudge(r, 1)}>
                      <IonIcon slot="icon-only" icon={add} />
                    </IonButton>
                  )}
                </div>
              </IonItem>
            ))}
          </IonList>
        )}
      </IonContent>
      <PosFooter />
    </IonPage>
  );
};

export default TodayPage;
