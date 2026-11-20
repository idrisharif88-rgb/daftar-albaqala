import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonInput, IonItem,
  IonList, IonModal, IonNote, IonPage, IonSearchbar, IonSegment, IonSegmentButton, IonTitle, IonToolbar,
  useIonViewWillEnter, useIonToast,
} from '@ionic/react';
import { add, pricetagsOutline, settingsOutline, personAddOutline } from 'ionicons/icons';
import { useAuth } from '../../lib/auth';
import { getSettings } from '../../data/settings';
import { getBalancesByCustomer } from '../../data/transactions';
import { formatMinor } from '../../data/money';
import { onSyncComplete, runSync } from '../../data/sync';
import { phoneInput } from '../../lib/digits';
import { pickContact } from '../../lib/contacts';
import { arabicDate } from './messages';
import WelcomeCard from '../../components/WelcomeCard';
import type { Customer } from '../../data/customers';
import {
  createMember, latestByMember, listMembers, statusOf, type ClubSubscription, type SubStatus,
} from './subscriptions';

// «دفتر النادي» — the club's first page (Phase 43, step 3; design approved
// 2026-11-20): status tabs, three totals, and a row per subscriber with a
// status chip. Tap → the subscriber's card (ClubMember).

type Filter = 'all' | 'active' | 'soon' | 'expired';

interface Row {
  member: Customer;
  latest: ClubSubscription | null;
  status: SubStatus;
  left: number;
  /** YER minor units still owed (> 0) — the ledger balance. */
  owed: number;
}

export const STATUS_AR: Record<SubStatus, string> = {
  active: 'ساري', soon: 'قارب', expired: 'منتهي', none: 'بلا اشتراك',
};

export function chipText(status: SubStatus, left: number): string {
  if (status === 'active') return `ساري · ${left} يوم`;
  if (status === 'soon') return left === 0 ? 'ينتهي اليوم' : `باقي ${left} يوم`;
  if (status === 'expired') return 'منتهي';
  return 'بلا اشتراك';
}

const ClubHome: React.FC = () => {
  const { logout } = useAuth();
  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // add-subscriber form
  const modal = useRef<HTMLIonModalElement>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [presentToast] = useIonToast();

  // «جهات الاتصال»: Android's own picker fills in the name and number.
  const fromContacts = async () => {
    try {
      const picked = await pickContact();
      if (!picked) return;
      if (picked.name) setName(picked.name);
      if (picked.phone) setPhone(phoneInput(picked.phone));
    } catch {
      void presentToast({ message: 'تعذّر فتح جهات الاتصال', duration: 2000, color: 'medium' });
    }
  };

  const load = useCallback(async () => {
    const [settings, members, latest, balances] = await Promise.all([
      getSettings(), listMembers(), latestByMember(), getBalancesByCustomer(),
    ]);
    setStoreName(settings.storeName.trim());
    setOwnerName(settings.ownerName.trim());
    setRows(members.map((m) => {
      const sub = latest.get(m.id) ?? null;
      const { status, left } = statusOf(sub);
      const owed = (balances.get(m.id) ?? []).find((b) => b.currency === 'YER')?.minor ?? 0;
      return { member: m, latest: sub, status, left, owed };
    }));
  }, []);

  useIonViewWillEnter(() => { void load(); });
  useEffect(() => onSyncComplete(() => { void load(); }), [load]);

  const counts = useMemo(() => {
    const c = { all: rows.length, active: 0, soon: 0, expired: 0, owed: 0 };
    for (const r of rows) {
      if (r.status === 'active') c.active++;
      else if (r.status === 'soon') c.soon++;
      else if (r.status === 'expired') c.expired++;
      if (r.owed > 0) c.owed += r.owed;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => filter === 'all' || r.status === filter)
      .filter((r) => !q || r.member.name.toLowerCase().includes(q) || r.member.phone.includes(q))
      // Most urgent first: about to end, then lapsed, then active, then none.
      .sort((a, b) => {
        const rank: Record<SubStatus, number> = { soon: 0, expired: 1, active: 2, none: 3 };
        return rank[a.status] - rank[b.status] || a.left - b.left;
      });
  }, [rows, search, filter]);

  const save = async () => {
    try {
      await createMember({ name, phone });
      await modal.current?.dismiss();
      setName(''); setPhone(''); setError(null);
      void runSync();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الحفظ');
    }
  };

  return (
    <IonPage className="club">
      <IonHeader>
        <IonToolbar>
          <IonTitle>{storeName || 'دفتر النادي'}</IonTitle>
          <IonButtons slot="start">
            <IonButton routerLink="/settings" aria-label="الإعدادات">
              <IonIcon slot="icon-only" icon={settingsOutline} />
            </IonButton>
            <IonButton routerLink="/club/packages" aria-label="الباقات">
              <IonIcon slot="icon-only" icon={pricetagsOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton onClick={logout}>خروج</IonButton>
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <IonSearchbar value={search} onIonInput={(e) => setSearch(e.detail.value ?? '')} placeholder="بحث بالاسم أو الهاتف" />
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={filter} onIonChange={(e) => setFilter((e.detail.value as Filter) ?? 'all')}>
            <IonSegmentButton value="all">الكل {counts.all}</IonSegmentButton>
            <IonSegmentButton value="active">ساري {counts.active}</IonSegmentButton>
            <IonSegmentButton value="soon">قارب {counts.soon}</IonSegmentButton>
            <IonSegmentButton value="expired">منتهي {counts.expired}</IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        {!search && <WelcomeCard name={ownerName} storeName={storeName} />}
        <div className="club-kpis">
          <div className="club-kpi"><b>{counts.active}</b><span>ساري</span></div>
          <div className="club-kpi club-kpi--warn"><b>{counts.soon}</b><span>ينتهي قريباً</span></div>
          <div className="club-kpi club-kpi--bad"><b>{formatMinor(counts.owed)}</b><span>متبقٍّ ر.ي</span></div>
        </div>

        {rows.length === 0 ? (
          <p className="club-empty">لا يوجد مشتركون بعد. أضف أول مشترك بالزر ➕</p>
        ) : shown.length === 0 ? (
          <p className="club-empty">لا نتائج.</p>
        ) : (
          <div className="club-list">
            {shown.map((r) => (
              <IonItem key={r.member.id} button detail={false} lines="none" className="club-row" routerLink={`/club/members/${r.member.id}`}>
                <div className="club-av" slot="start" aria-hidden="true">{Array.from(r.member.name.trim())[0] ?? '؟'}</div>
                <div className="club-row__tx">
                  <b>{r.member.name}</b>
                  <span>
                    {r.latest
                      ? `${r.latest.package_name} · ${r.status === 'expired' ? 'انتهى' : 'ينتهي'} ${arabicDate(r.latest.end_date)}`
                      : r.member.phone}
                    {r.owed > 0 && <> · <em>متبقٍّ {formatMinor(r.owed)}</em></>}
                  </span>
                </div>
                <span slot="end" className={`club-chip club-chip--${r.status}`}>{chipText(r.status, r.left)}</span>
              </IonItem>
            ))}
          </div>
        )}

        <IonFab vertical="bottom" horizontal="start" slot="fixed">
          <IonFabButton id="club-add-member" className="club-fab" aria-label="مشترك جديد">
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

        <IonModal className="club-sheet" ref={modal} trigger="club-add-member" initialBreakpoint={0.65} breakpoints={[0, 0.65, 0.9]}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>مشترك جديد</IonTitle>
              <IonButtons slot="end"><IonButton onClick={() => modal.current?.dismiss()}>إلغاء</IonButton></IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonButton expand="block" fill="outline" className="club-btn-out" onClick={() => void fromContacts()}>
              <IonIcon slot="start" icon={personAddOutline} />
              جهات الاتصال
            </IonButton>
            <IonList>
              <IonItem>
                <IonInput label="الاسم" labelPlacement="stacked" value={name} placeholder="مثال: علي سالم"
                  onIonInput={(e) => setName(e.detail.value ?? '')} />
              </IonItem>
              <IonItem>
                <IonInput label="رقم الهاتف" labelPlacement="stacked" value={phone} inputmode="tel" type="tel"
                  onIonInput={(e) => setPhone(phoneInput(e.detail.value ?? ''))} />
              </IonItem>
            </IonList>
            {error && <IonNote color="danger" className="club-err">{error}</IonNote>}
            <IonButton expand="block" className="club-btn ion-margin-top" disabled={!name.trim() || !phone.trim()} onClick={() => void save()}>
              حفظ
            </IonButton>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default ClubHome;
