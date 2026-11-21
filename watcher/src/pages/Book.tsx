import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonIcon, IonSearchbar, IonRefresher, IonRefresherContent, IonSpinner,
  IonSegment, IonSegmentButton, IonLabel,
  useIonViewWillEnter, useIonRouter, useIonToast, useIonActionSheet,
} from '@ionic/react';
import { downloadOutline } from 'ionicons/icons';
import { ApiError, ClubSub, Contact, exportBook, getBook, getClub } from '../lib/api';
import { ROLE_AR, arabicDate, balanceText, isClubRole, isContractorRole } from '../lib/format';
import { digitsOnly } from '../lib/digits';

// One account's book: its live contacts, each with a balance per currency.
// Tapping a contact opens its entries (Contact.tsx).
//
// One account can keep TWO books — «دفتر البقالة» and «دفتر المقاول» — told
// apart by role code, exactly as each app tells them apart. A tab per book, so
// the same person as a grocery partner and a contractor's worker are never two
// rows of one list.

type BookTab = 'grocery' | 'contractor' | 'club';

/** Whole days from today to `day` (local calendar). */
function daysLeft(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86_400_000);
}
function subStatus(s: ClubSub | undefined): string {
  if (!s) return 'بلا اشتراك';
  const left = daysLeft(s.end_date);
  if (left < 0) return 'منتهي';
  if (left === 0) return 'ينتهي اليوم';
  return left <= 3 ? `باقي ${left} يوم` : `ساري · ${left} يوم`;
}

const Book: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState('الدفتر');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  // «دفتر النادي»: each subscriber's latest subscription, by contact id.
  const [latest, setLatest] = useState<Map<string, ClubSub>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<BookTab>('grocery');
  const [exporting, setExporting] = useState(false);
  const router = useIonRouter();
  const [presentToast] = useIonToast();
  const [presentSheet] = useIonActionSheet();

  const load = useCallback(async () => {
    setError(null);
    try {
      const [res, club] = await Promise.all([getBook(id), getClub(id).catch(() => ({ subscriptions: [] }))]);
      setTitle(res.account.store_name || res.account.phone);
      setContacts(res.customers);
      const map = new Map<string, ClubSub>();
      for (const s of club.subscriptions) map.set(s.customer_id, s); // ordered by end date: last = latest
      setLatest(map);
      // A club's book opens on its own tab.
      if (res.customers.some((c) => isClubRole(c.role)) && !res.customers.some((c) => !isClubRole(c.role))) setTab('club');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    }
  }, [id]);

  // Reload on every visit: coming back from a contact, its balance may have changed.
  useIonViewWillEnter(() => { void load(); }, [load]);

  // Hand the whole book over as a file — what a grocer gets when he asks for a
  // copy of his data. The server sends it in one response; the file is built
  // here, so nothing is stored on the droplet to go stale or leak.
  //
  // Two formats, because they answer different questions: the PDF is the copy
  // he READS, the spreadsheet the one he (or whoever helps him) can sum, sort
  // and filter. Neither is a substitute for the other, so he is asked.
  // Which book a contact belongs to — by role code, as each app decides.
  const inTab = useCallback((c: { role: string }, t: BookTab) => (
    t === 'club' ? isClubRole(c.role)
      : t === 'contractor' ? isContractorRole(c.role)
        : !isContractorRole(c.role) && !isClubRole(c.role)
  ), []);

  const exportAs = useCallback(async (format: 'pdf' | 'excel') => {
    setExporting(true);
    try {
      // Only the open tab's book — the two apps' books never share a file.
      const whole = await exportBook(id);
      const customers = whole.customers.filter((c) => inTab(c, tab));
      const ids = new Set(customers.map((c) => c.id));
      const book = {
        ...whole,
        customers,
        transactions: whole.transactions.filter((t) => ids.has(t.customer_id)),
        book_label: tab === 'contractor' ? 'دفتر المقاول' : tab === 'club' ? 'دفتر النادي' : 'دفتر البقالة',
      };
      if (format === 'pdf') {
        const { exportBookToPdf } = await import('../lib/pdfBook');
        await exportBookToPdf(book);
      } else {
        const { exportBookToFile } = await import('../lib/exportBook');
        await exportBookToFile(book);
      }
    } catch (err) {
      presentToast({
        message: err instanceof ApiError ? err.message
          : err instanceof Error ? err.message : 'تعذّر تصدير الدفتر',
        duration: 2500,
        color: 'danger',
      });
    } finally {
      setExporting(false);
    }
  }, [id, presentToast, tab, inTab]);

  const chooseFormat = useCallback(() => {
    presentSheet({
      header: 'تصدير الدفتر',
      buttons: [
        { text: 'ملف PDF', handler: () => { void exportAs('pdf'); } },
        { text: 'ملف Excel', handler: () => { void exportAs('excel'); } },
        { text: 'إلغاء', role: 'cancel' },
      ],
    });
  }, [presentSheet, exportAs]);


  const counts = useMemo(() => ({
    grocery: (contacts ?? []).filter((c) => inTab(c, 'grocery')).length,
    contractor: (contacts ?? []).filter((c) => inTab(c, 'contractor')).length,
    club: (contacts ?? []).filter((c) => inTab(c, 'club')).length,
  }), [contacts, inTab]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = digitsOnly(q);
    return (contacts ?? []).filter((c) => inTab(c, tab) && (
      !q || c.name.toLowerCase().includes(q) || (qDigits !== '' && c.phone.includes(qDigits))
    ));
  }, [contacts, query, tab, inTab]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/accounts" text="" /></IonButtons>
          <IonTitle>{title}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={chooseFormat} disabled={exporting || !contacts}>
              {exporting
                ? <IonSpinner name="crescent" />
                : <IonIcon slot="icon-only" icon={downloadOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value as BookTab)}>
            <IonSegmentButton value="grocery">
              <IonLabel>دفتر البقالة ({counts.grocery})</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="contractor">
              <IonLabel>دفتر المقاول ({counts.contractor})</IonLabel>
            </IonSegmentButton>
            {counts.club > 0 && (
              <IonSegmentButton value="club">
                <IonLabel>النادي ({counts.club})</IonLabel>
              </IonSegmentButton>
            )}
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await load(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>

        <IonSearchbar
          value={query}
          onIonInput={(e) => setQuery(e.detail.value ?? '')}
          placeholder="بحث بالاسم أو الرقم"
        />

        {error && <div className="empty">{error}</div>}
        {!contacts && !error && <div className="empty"><IonSpinner name="crescent" /></div>}
        {contacts && shown.length === 0 && <div className="empty">لا توجد جهات</div>}

        {shown.map((c) => (
          <div key={c.id} className="acct acct--link" role="button"
            onClick={() => router.push(`/accounts/${id}/customers/${c.id}`)}>
            <div className="acct__top">
              <div>
                <div className="acct__name">{c.name}</div>
                <div className="acct__phone">{c.phone}</div>
              </div>
              <span className="badge badge--role">{ROLE_AR[c.role] ?? c.role}</span>
            </div>
            {isClubRole(c.role) && (() => {
              const s = latest.get(c.id);
              return (
                <div className="acct__meta club-sub">
                  {s ? (
                    <>
                      {s.package_name} · {Number(s.price).toLocaleString('en-US')} ر.ي
                      {s.price < s.list_price && ` (خصم ${(s.list_price - s.price).toLocaleString('en-US')})`}
                      <br />
                      <span className="tri tri--up" aria-label="البداية" />{arabicDate(s.start_date)}
                      {'  '}<span className="tri tri--down" aria-label="النهاية" />{arabicDate(s.end_date)}
                      {' · '}<b>{subStatus(s)}</b>
                    </>
                  ) : subStatus(undefined)}
                </div>
              );
            })()}
            <div className="acct__meta">
              {c.balances.length === 0 ? 'مسدد' : c.balances.map(balanceText).join(' · ')}
              <br />
              حركات: {c.transactions_count ?? 0}
            </div>
          </div>
        ))}
      </IonContent>
    </IonPage>
  );
};

export default Book;
