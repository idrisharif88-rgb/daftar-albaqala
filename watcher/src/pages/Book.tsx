import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonSearchbar, IonRefresher, IonRefresherContent, IonSpinner, useIonViewWillEnter, useIonRouter,
} from '@ionic/react';
import { ApiError, Contact, getBook } from '../lib/api';
import { ROLE_AR, balanceText } from '../lib/format';
import { digitsOnly } from '../lib/digits';

// One account's book: its live contacts, each with a balance per currency.
// Tapping a contact opens its entries (Contact.tsx).

const Book: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState('الدفتر');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const router = useIonRouter();

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = digitsOnly(q);
    return (contacts ?? []).filter((c) =>
      !q || c.name.toLowerCase().includes(q) || (qDigits !== '' && c.phone.includes(qDigits))
    );
  }, [contacts, query]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/accounts" text="" /></IonButtons>
          <IonTitle>{title}</IonTitle>
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
