import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonIcon, IonSearchbar, IonRefresher, IonRefresherContent, IonSpinner,
  IonSegment, IonSegmentButton, IonLabel,
  useIonViewWillEnter, useIonRouter, useIonToast, useIonActionSheet,
} from '@ionic/react';
import { downloadOutline } from 'ionicons/icons';
import { ApiError, Contact, exportBook, getBook } from '../lib/api';
import { ROLE_AR, balanceText, isContractorRole } from '../lib/format';
import { digitsOnly } from '../lib/digits';

// One account's book: its live contacts, each with a balance per currency.
// Tapping a contact opens its entries (Contact.tsx).
//
// One account can keep TWO books — «دفتر البقالة» and «دفتر المقاول» — told
// apart by role code, exactly as each app tells them apart. A tab per book, so
// the same person as a grocery partner and a contractor's worker are never two
// rows of one list.

type BookTab = 'grocery' | 'contractor';

const Book: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState('الدفتر');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
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
      const res = await getBook(id);
      setTitle(res.account.store_name || res.account.phone);
      setContacts(res.customers);
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
  const inTab = useCallback((c: { role: string }, t: BookTab) =>
    isContractorRole(c.role) === (t === 'contractor'), []);

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
        book_label: tab === 'contractor' ? 'دفتر المقاول' : 'دفتر البقالة',
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
