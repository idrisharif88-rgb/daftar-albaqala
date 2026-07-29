import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonList, IonItem, IonLabel, IonText, IonSpinner, IonFab, IonFabButton, IonIcon,
  IonModal, IonInput, IonNote, IonSearchbar, IonSegment, IonSegmentButton,
  IonSelect, IonSelectOption, IonChip, useIonViewWillEnter, useIonToast,
} from '@ionic/react';
import { add, settingsOutline, personCircleOutline, checkmarkCircle } from 'ionicons/icons';
import { useAuth } from '../lib/auth';
import { listCustomers, createCustomer, type Customer } from '../data/customers';
import { getBalancesByCustomer } from '../data/transactions';
import { runSync, getSyncHealth, needsAttention, onSyncComplete } from '../data/sync';
import { isAccountActive, INACTIVE_MESSAGE } from '../data/account';
import { getSettings } from '../data/settings';
import { getRates } from '../data/rates';
import { DEFAULT_RATES, type CurrencyBalance, type Rates } from '../data/currencies';
import { ROLES, roleDef, type ContactRole } from '../data/roles';
import { pickContact } from '../lib/contacts';
import BalanceSummary from '../components/BalanceSummary';
import { SyncWarning, SYNC_PROBLEM_TEXT } from '../components/SyncWarning';

// A contact plus its locally-computed running balances (one per currency).
interface Row {
  customer: Customer;
  balances: CurrencyBalance[];
}

// 'all' is the default tab: most books hold one kind of contact, and making a
// grocer who only has customers pick a category would be noise.
type RoleFilter = ContactRole | 'all';

// Contact list — the owner's home. Reads contacts + running balances from the
// local data layer (offline-first) and offers an "add contact" flow.
const Home: React.FC = () => {
  const { logout } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [syncProblem, setSyncProblem] = useState<string | null>(null);
  // Store name for the header — read from persisted settings (app_meta), not the
  // in-memory auth user, which is null after an app restart.
  const [storeName, setStoreName] = useState('');

  // add-customer modal state
  const modal = useRef<HTMLIonModalElement>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [role, setRole] = useState<ContactRole>('customer');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // synchronous double-tap guard (see CustomerDetail)
  const [syncing, setSyncing] = useState(false);
  const [presentToast] = useIonToast();

  const load = useCallback(async () => {
    // One grouped balance query for the whole list instead of one per contact —
    // the old per-row await was an N+1 across the Capacitor bridge.
    const [customers, settings, currentRates, balancesByCustomer, health] = await Promise.all([
      listCustomers(), getSettings(), getRates(), getBalancesByCustomer(), getSyncHealth(),
    ]);
    setRows(customers.map((c) => ({ customer: c, balances: balancesByCustomer.get(c.id) ?? [] })));
    setStoreName(settings.storeName?.trim() ?? '');
    setRates(currentRates);
    setRole(settings.defaultRole);
    setSyncProblem(needsAttention(health) ? health.status : null);
    setLoading(false);
  }, []);

  // Reload every time the page becomes active (e.g. returning from a detail
  // screen after recording a transaction) so balances stay fresh.
  useIonViewWillEnter(() => { void load(); });

  // Also reload when a sync finishes. The auto-sync at app open runs alongside
  // this screen, so without this the list sits showing pre-sync data — and the
  // warning triangle would only appear after navigating away and back.
  useEffect(() => onSyncComplete(() => { void load(); }), [load]);

  // Manual sync, then refresh the list (a pull may add customers / change balances).
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await runSync();
      const toast = {
        ok: { message: 'تمت المزامنة', cssClass: 'toast-sync-ok', icon: checkmarkCircle },
        offline: { message: SYNC_PROBLEM_TEXT.offline, color: 'medium' },
        subscription: { message: SYNC_PROBLEM_TEXT.subscription, color: 'warning' },
        error: { message: SYNC_PROBLEM_TEXT.error, color: 'danger' },
        partial: { message: SYNC_PROBLEM_TEXT.partial, color: 'warning' },
      }[r.status];
      await load();
      await presentToast({ ...toast, duration: 2000 });
    } finally {
      setSyncing(false);
    }
  };

  const resetForm = () => {
    setName(''); setPhone(''); setNote(''); setError(null);
  };

  // Fill name + phone from a saved contact (native picker; no-op on web).
  const chooseContact = async () => {
    try {
      const picked = await pickContact();
      if (!picked) return;
      if (picked.name) setName(picked.name);
      if (picked.phone) setPhone(picked.phone);
    } catch {
      await presentToast({ message: 'تعذّر فتح جهات الاتصال', color: 'medium', duration: 2000 });
    }
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError('الاسم مطلوب'); return; }
    if (!phone.trim()) { setError('رقم الهاتف مطلوب'); return; }
    if (savingRef.current) return; // a save is already in flight — ignore the re-tap
    savingRef.current = true;
    setSaving(true);
    try {
      await createCustomer({ name, phone, note: note.trim() || null, role });
      await load();
      resetForm();
      await modal.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const term = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (roleFilter !== 'all' && r.customer.role !== roleFilter) return false;
    if (!term) return true;
    return r.customer.name.toLowerCase().includes(term) || r.customer.phone.includes(term);
  });
  // Only offer the role tabs once the book actually holds more than one kind.
  const showRoleTabs = new Set(rows.map((r) => r.customer.role)).size > 1;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{storeName || 'دفتر البقالة'}</IonTitle>
          <IonButtons slot="start">
            <IonButton routerLink="/settings">
              <IonIcon slot="icon-only" icon={settingsOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            {/* Standing warning that the book isn't fully backed up. Tapping it
                retries the sync, so the fix is one press from where the problem
                is shown. */}
            {syncProblem && (
              <SyncWarning
                onRetry={() => { void sync(); }}
                busy={syncing}
                label={SYNC_PROBLEM_TEXT[syncProblem]}
              />
            )}
            <IonButton onClick={logout}>خروج</IonButton>
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <IonSearchbar
            value={search}
            onIonInput={(e) => setSearch(e.detail.value ?? '')}
            placeholder="بحث بالاسم أو الهاتف"
          />
        </IonToolbar>
        {showRoleTabs && (
          <IonToolbar>
            <IonSegment
              value={roleFilter}
              onIonChange={(e) => setRoleFilter((e.detail.value as RoleFilter) ?? 'all')}
            >
              <IonSegmentButton value="all">الكل</IonSegmentButton>
              {ROLES.map((r) => (
                <IonSegmentButton key={r.role} value={r.role}>{r.pluralAr}</IonSegmentButton>
              ))}
            </IonSegment>
          </IonToolbar>
        )}
      </IonHeader>

      <IonContent>
        {loading ? (
          <div className="ion-text-center ion-padding">
            <IonSpinner name="crescent" />
          </div>
        ) : rows.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">
              لا توجد جهات بعد. أضف أول جهة بالزر بالأسفل ➕
            </p>
          </IonText>
        ) : visible.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">لا توجد نتائج للبحث.</p>
          </IonText>
        ) : (
          // Tapping a row opens the customer detail (transactions + add
          // debt/payment).
          <IonList>
            {visible.map(({ customer, balances }) => (
              <IonItem key={customer.id} button routerLink={`/customers/${customer.id}`}>
                <IonLabel>
                  <h2>{customer.name}</h2>
                  <p>{customer.phone}</p>
                  {/* The role chip only earns its space in a mixed book. */}
                  {showRoleTabs && (
                    <IonChip outline color="medium" style={{ height: 20, fontSize: '0.7em' }}>
                      {roleDef(customer.role).labelAr}
                    </IonChip>
                  )}
                </IonLabel>
                <BalanceSummary slot="end" balances={balances} rates={rates} compact />
              </IonItem>
            ))}
          </IonList>
        )}

        {/* Manual sync — a big round olive button below the list. */}
        {!loading && (
          <button type="button" className="sync-round-btn" onClick={sync} disabled={syncing}>
            {syncing ? <IonSpinner name="crescent" /> : 'تحديث'}
          </button>
        )}

        <IonFab slot="fixed" vertical="bottom" horizontal="start">
          <IonFabButton onClick={async () => {
            if (!(await isAccountActive())) {
              await presentToast({ message: INACTIVE_MESSAGE, color: 'warning', duration: 2500 });
              return;
            }
            resetForm();
            void modal.current?.present();
          }}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

        <IonModal ref={modal} onDidDismiss={resetForm}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>جهة جديدة</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => modal.current?.dismiss()}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">الاسم</IonLabel>
              <IonInput
                value={name}
                onIonInput={(e) => setName(e.detail.value ?? '')}
                placeholder="الاسم"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">الصفة</IonLabel>
              <IonSelect
                value={role}
                onIonChange={(e) => setRole(e.detail.value as ContactRole)}
                interface="popover"
              >
                {ROLES.map((r) => (
                  <IonSelectOption key={r.role} value={r.role}>{r.labelAr}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonButton
              expand="block"
              fill="outline"
              onClick={chooseContact}
              className="ion-margin-top"
            >
              <IonIcon slot="start" icon={personCircleOutline} />
              جهات الاتصال
            </IonButton>
            <IonItem>
              <IonLabel position="stacked">رقم الهاتف</IonLabel>
              <IonInput
                type="tel"
                inputmode="tel"
                value={phone}
                onIonInput={(e) => setPhone(e.detail.value ?? '')}
                placeholder="7XXXXXXXX"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">ملاحظة (اختياري)</IonLabel>
              <IonInput
                value={note}
                onIonInput={(e) => setNote(e.detail.value ?? '')}
              />
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

export default Home;
