import { useCallback, useRef, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonList, IonItem, IonLabel,
  IonText, IonListHeader, IonSpinner, IonBadge, IonButton, IonIcon, IonFab, IonFabButton, IonModal, IonSearchbar,
  useIonViewWillEnter, useIonAlert, useIonToast,
} from '@ionic/react';
import { remove, lockClosedOutline, checkmarkCircle } from 'ionicons/icons';
import { ICONS, ICON_LABELS } from './icons';
import { shareDayReport } from './reportPdf';
import { matchesQuery } from './search';
import { runPosSync, getPosLastSync } from './posSync';
import { useDriveBackup } from '../../lib/useDriveBackup';
import { GOOGLE_ENABLED } from '../../lib/googleDrive';
import { useAuth } from '../../lib/auth';
import { usePosPermissions } from './permissions';
import PosFooter from './PosFooter';
import {
  addBaked, getDayRows, localDay, totalsOf, retentionDue, keepForAnotherYear,
  deleteOlderThanYear, getDayLock, lockDay, unlockDay, eraseDay, removeProductFromDay,
  type DayRow, type DayLock,
} from './stock';
import { formatMinor } from '../../data/money';
import { toLatinDigits } from '../../lib/digits';

// «اليوم» — the day's baking: for every product, how many were baked, how many
// sold, how many are left. Tap a product to add what was just baked.
const TodayPage: React.FC = () => {
  const [rows, setRows] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lock, setLock] = useState<DayLock>({ locked: false, reopened: 0 });
  const [lastSync, setLastSync] = useState<string | null>(null);
  // «إضافة منتج لليوم»: the products not baked today are hidden from the list;
  // this picker is how one joins it.
  const addModal = useRef<HTMLIonModalElement>(null);
  const [pickSearch, setPickSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const { driveBackupAllowed, staff } = useAuth();
  // What this person may do here (the owner may do everything). The server
  // refuses the rest anyway; these only keep refused buttons off the screen.
  const can = usePosPermissions();
  const canAdd = can('add_stock');
  // Clearing writes opposite rows of BOTH baked and sales.
  const canErase = canAdd && can('sell');
  const canSubmit = can('submit_day');
  const seeReports = can('see_reports');
  const driveOn = driveBackupAllowed && GOOGLE_ENABLED;
  const drive = useDriveBackup();
  const [presentToast] = useIonToast();
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
    setLastSync(await getPosLastSync());
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

  // The one-year question is the owner's: a staff member's phone keeps a copy only.
  useIonViewWillEnter(() => { void load().then(() => (staff ? undefined : askRetention())); });

  // + / − change the baked count by one, instantly: the screen updates first
  // and the write follows (a failed write reloads the truth).
  const nudge = (r: DayRow, by: 1 | -1) => {
    setRows((all) => all.map((x) => x.product.id === r.product.id
      ? { ...x, baked: x.baked + by, left: x.left + by } : x));
    // (for a carry-over product `left` is the shelf stock, which moves the same way)
    addBaked(r.product.id, by).catch((err: unknown) => {
      void load(); // show the truth again
      presentNote({ header: 'لا يمكن التعديل', message: err instanceof Error ? err.message : 'حدث خطأ', buttons: ['حسناً'] });
    });
  };

  // For a big batch: tap the number and type it («أخبزنا 60»).
  const askBaked = (r: DayRow) => {
    presentAlert({
      header: r.product.name,
      message: r.product.daily ? `مخبوز اليوم: ${r.baked}. كم تضيف؟` : `المخزون الحالي: ${r.left}. كم تضيف؟`,
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

  // The round trip the owner can trust: sync with the server; if this account
  // has no server sync, back up to Google Drive instead (the POS data is in the
  // Drive file too). The SERVER decides which, at the moment of the tap.
  const syncNow = async () => {
    if (syncing || drive.busy) return;
    setSyncing(true);
    try {
      const r = await runPosSync();
      if (r.status === 'skipped') {
        if (driveOn) {
          setSyncing(false);
          await drive.backup();
          return;
        }
        await presentToast({ message: 'المزامنة متوقفة لهذا الحساب.', color: 'warning', duration: 2600 });
      } else if (r.status === 'ok') {
        await load();
        await presentToast({
          message: r.refused > 0 ? `تمت المزامنة، لكن ${r.refused} سجل لم يُقبل.` : '',
          icon: r.refused > 0 ? undefined : checkmarkCircle,
          cssClass: r.refused > 0 ? undefined : 'toast-sync-ok',
          position: 'top',
          color: r.refused > 0 ? 'warning' : undefined,
          duration: r.refused > 0 ? 3000 : 1200,
        });
      } else if (r.status === 'offline') {
        await presentToast({ message: 'لا يوجد اتصال بالإنترنت.', color: 'medium', duration: 2600 });
      } else {
        await presentToast({ message: 'تعذّرت المزامنة. حاول مرة أخرى.', color: 'danger', duration: 2600 });
      }
    } finally {
      setSyncing(false);
    }
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

  // «مسح قائمة اليوم»: baked, sold and takings back to zero. Asks first, and asks
  // harder when the day was already submitted (it is reopened, and counted).
  const eraseToday = () => {
    presentConfirm({
      header: 'مسح قائمة اليوم',
      message: lock.locked
        ? 'اليوم معتمد. سيُفتح للتعديل ويُسجَّل ذلك، ثم يُصفَّر المخبوز والمباع والإيراد لهذا اليوم وتُفرَّغ القائمة. لا يمكن التراجع. متأكد؟'
        : 'سيُصفَّر المخبوز والمباع والإيراد لهذا اليوم وتُفرَّغ القائمة. لا يمكن التراجع. متأكد؟',
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'نعم، امسح', role: 'destructive',
          handler: () => {
            eraseDay().then(load).then(() => presentToast({ message: 'تم مسح قائمة اليوم', duration: 1800 }))
              .catch((err: unknown) => {
                presentNote({ header: 'تعذّر المسح', message: err instanceof Error ? err.message : 'حدث خطأ', buttons: ['حسناً'] });
              });
          },
        },
      ],
    });
  };

  // «حذف من قائمة اليوم»: one product back to zero (same rules as clearing all).
  const removeOne = (r: DayRow) => {
    presentConfirm({
      header: 'حذف من قائمة اليوم',
      message: `حذف «${r.product.name}» من قائمة اليوم؟ سيُصفَّر مخبوزه (${r.baked}) ومبيعه (${r.sold}) لهذا اليوم. لا يمكن التراجع.`,
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'حذف', role: 'destructive',
          handler: () => {
            removeProductFromDay(r.product.id).then(load).catch((err: unknown) => {
              presentNote({ header: 'تعذّر الحذف', message: err instanceof Error ? err.message : 'حدث خطأ', buttons: ['حسناً'] });
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
  // Quantities can be changed: the day is open AND this person may add.
  const editable = !lock.locked && canAdd;
  // Only what is part of today: baked or sold. A product with nothing today is
  // not shown — thirty rows of zeros bury the five that matter.
  // Carry-over products (vinegar, honey, ghee) are a list of their own: they
  // are always shown, with the stock on the shelf, whatever happened today.
  const dailyRows = rows.filter((r) => r.product.daily);
  const stockRows = rows.filter((r) => !r.product.daily);
  const active = dailyRows.filter((r) => r.baked !== 0 || r.sold !== 0);
  const idle = dailyRows.filter((r) => r.baked === 0 && r.sold === 0);
  const pickable = idle.filter((r) => matchesQuery(r.product, pickSearch));
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>اليوم</IonTitle>
          <IonButtons slot="end">
            <IonButton aria-label="مزامنة" disabled={syncing || !!drive.busy} onClick={() => { void syncNow(); }}>
              {syncing || drive.busy
                ? <IonSpinner name="crescent" />
                : <IonIcon slot="icon-only" icon={ICONS.sync} />}
            </IonButton>
            {canErase && active.length > 0 && (
              <IonButton aria-label="مسح قائمة اليوم" color="danger" onClick={eraseToday}>
                <IonIcon slot="icon-only" icon={ICONS.trash} />
              </IonButton>
            )}
            {seeReports && rows.length > 0 && (
              <IonButton aria-label="مشاركة تقرير اليوم" onClick={() => {
                shareDayReport(localDay()).catch((err: unknown) => {
                  presentNote({ header: 'تعذّرت المشاركة', message: err instanceof Error ? err.message : 'حدث خطأ غير متوقع', buttons: ['حسناً'] });
                });
              }}>
                <IonIcon slot="icon-only" icon={ICONS.share} />
              </IonButton>
            )}
          </IonButtons>
        </IonToolbar>
        {!loading && rows.length > 0 && (
          <IonToolbar>
            <div style={{ display: 'flex', justifyContent: 'space-around', padding: '4px 8px', fontSize: '.9rem' }}>
              <span>مخبوز <b>{t.baked}</b></span>
              <span>مباع <b>{t.sold}</b></span>
              <span>متبقي <b>{t.left}</b></span>
              {seeReports && <span>الإيراد <b>{formatMinor(t.revenue)}</b></span>}
            </div>
          </IonToolbar>
        )}
        {!loading && rows.length > 0 && (
          <IonToolbar>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
              {lock.locked ? (
                <>
                  <span><IonIcon icon={lockClosedOutline} /> الكميات معتمدة</span>
                  {canSubmit && <IonButton fill="outline" size="small" onClick={reopen}>تعديل</IonButton>}
                </>
              ) : (
                <>
                  <span>{lock.reopened > 0 ? 'الكميات مفتوحة للتعديل' : 'المخزون اليومي'}</span>
                  {canSubmit && (
                    <IonButton
                      disabled={t.baked <= 0} onClick={submit}
                      aria-label={ICON_LABELS.confirm} title={ICON_LABELS.confirm}
                    >
                      <IonIcon slot="icon-only" icon={ICONS.confirm} style={{ fontSize: 36 }} />
                    </IonButton>
                  )}
                </>
              )}
            </div>
          </IonToolbar>
        )}
      </IonHeader>

      <IonContent>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 16px', fontSize: '.85rem', opacity: .75 }}>
          <span dir="ltr">{localDay()}</span>
          <span>
            {lastSync
              ? `آخر مزامنة: ${new Date(lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
              : 'لم تتم مزامنة بعد'}
          </span>
        </div>
        {loading ? (
          <div className="ion-text-center ion-padding"><IonSpinner name="crescent" /></div>
        ) : rows.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">أضف منتجاتك أولاً من تبويب «المنتجات».</p>
          </IonText>
        ) : active.length === 0 && stockRows.length > 0 ? null : active.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">
              لا توجد منتجات لهذا اليوم بعد. اضغط ➕ لإضافة ما خبزته.
            </p>
          </IonText>
        ) : (
          <IonList>
            {active.map((r) => (
              <IonItem key={r.product.id}>
                {!lock.locked && canErase && (
                  <IonButton
                    slot="start" fill="clear" color="danger"
                    aria-label="حذف من قائمة اليوم" title="حذف من قائمة اليوم"
                    onClick={() => removeOne(r)}
                  >
                    <IonIcon slot="icon-only" icon={ICONS.trash} />
                  </IonButton>
                )}
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
                  {editable && (
                    <IonButton
                      fill="outline" shape="round" aria-label="إنقاص"
                      disabled={r.baked <= r.sold} onClick={() => nudge(r, -1)}
                    >
                      <IonIcon slot="icon-only" icon={remove} />
                    </IonButton>
                  )}
                  <button
                    type="button" disabled={!editable}
                    onClick={() => askBaked(r)} aria-label="إدخال كمية"
                    style={{
                      minWidth: 44, padding: '8px 4px', font: 'inherit', fontWeight: 700,
                      fontSize: '1.25rem', background: 'transparent', border: 0,
                      color: 'inherit', fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {r.baked}
                  </button>
                  {editable && (
                    <IonButton shape="round" aria-label="زيادة" onClick={() => nudge(r, 1)}>
                      <IonIcon slot="icon-only" icon={ICONS.add} />
                    </IonButton>
                  )}
                </div>
              </IonItem>
            ))}
          </IonList>
        )}

        {stockRows.length > 0 && (
          <IonList>
            <IonListHeader><IonLabel>المخزون الدائم</IonLabel></IonListHeader>
            {stockRows.map((r) => (
              <IonItem key={r.product.id}>
                <IonLabel className="ion-text-wrap">
                  <h2>{r.product.name}</h2>
                  <p>
                    مباع اليوم {r.sold} · في المخزون{' '}
                    {r.left <= 0 ? <IonBadge color="danger">نفد</IonBadge> : <b>{r.left}</b>}
                  </p>
                </IonLabel>
                <div slot="end" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {canAdd && (
                    <IonButton
                      fill="outline" shape="round" aria-label="إنقاص"
                      disabled={r.left <= 0} onClick={() => nudge(r, -1)}
                    >
                      <IonIcon slot="icon-only" icon={remove} />
                    </IonButton>
                  )}
                  <button
                    type="button" disabled={!canAdd} onClick={() => askBaked(r)} aria-label="إضافة مخزون"
                    style={{
                      minWidth: 44, padding: '8px 4px', font: 'inherit', fontWeight: 700,
                      fontSize: '1.25rem', background: 'transparent', border: 0,
                      color: 'inherit', fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {r.left}
                  </button>
                  {canAdd && (
                    <IonButton shape="round" aria-label="زيادة" onClick={() => nudge(r, 1)}>
                      <IonIcon slot="icon-only" icon={ICONS.add} />
                    </IonButton>
                  )}
                </div>
              </IonItem>
            ))}
          </IonList>
        )}

        {editable && idle.length > 0 && (
          <IonFab slot="fixed" vertical="bottom" horizontal="start">
            <IonFabButton aria-label="إضافة منتج لليوم" onClick={() => { setPickSearch(''); void addModal.current?.present(); }}>
              <IonIcon icon={ICONS.add} />
            </IonFabButton>
          </IonFab>
        )}

        <IonModal ref={addModal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>إضافة منتج لليوم</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => addModal.current?.dismiss()}>إغلاق</IonButton>
              </IonButtons>
            </IonToolbar>
            <IonToolbar>
              <IonSearchbar
                value={pickSearch} placeholder="بحث عن منتج"
                onIonInput={(e) => setPickSearch(e.detail.value ?? '')}
              />
            </IonToolbar>
          </IonHeader>
          <IonContent>
            <IonList>
              {pickable.map((r) => (
                <IonItem
                  key={r.product.id} button
                  onClick={() => { void addModal.current?.dismiss().then(() => askBaked(r)); }}
                >
                  <IonLabel className="ion-text-wrap">{r.product.name}</IonLabel>
                </IonItem>
              ))}
              {pickable.length === 0 && (
                <IonText color="medium"><p className="ion-text-center ion-padding">المنتج غير موجود</p></IonText>
              )}
            </IonList>
          </IonContent>
        </IonModal>
      </IonContent>
      <PosFooter />
    </IonPage>
  );
};

export default TodayPage;
