import { useMemo, useRef, useState } from 'react';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonSearchbar, IonSegment, IonSegmentButton, IonLabel,
} from '@ionic/react';
import { parseBookFile, type BookFile as Book, type FileContact } from '../lib/bookFile';
import { ROLE_AR, balanceText, isContractorRole, money, dateTime, roleBadge } from '../lib/format';
import { digitsOnly } from '../lib/digits';

// «فتح ملف دفتر»: a book a grocer sent as a file, read on this phone only.
// Read-only on purpose — the book belongs to his phone; a correction is made
// there, with him, not in a copy that would never go back.

type BookTab = 'grocery' | 'contractor';

const BookFile: React.FC = () => {
  const input = useRef<HTMLInputElement>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<FileContact | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<BookTab>('grocery');

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setOpen(null);
    try {
      setBook(parseBookFile(await file.text()));
    } catch (err) {
      setBook(null);
      setError(err instanceof Error ? err.message : 'تعذّرت قراءة الملف');
    }
  };

  const hasContractor = !!book?.contacts.some((c) => isContractorRole(c.role));
  const shown = useMemo(() => {
    if (!book) return [];
    const q = query.trim();
    const qd = digitsOnly(q);
    return book.contacts
      .filter((c) => isContractorRole(c.role) === (tab === 'contractor'))
      .filter((c) => !q || c.name.includes(q) || (qd && c.phone.includes(qd)));
  }, [book, query, tab]);
  const entries = useMemo(
    () => (open && book ? book.entries.filter((e) => e.customer_id === open.id) : []),
    [open, book],
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            {open
              ? <IonButton onClick={() => setOpen(null)}>رجوع</IonButton>
              : <IonBackButton defaultHref="/accounts" text="" />}
          </IonButtons>
          <IonTitle>{open ? open.name : book?.storeName || 'ملف دفتر'}</IonTitle>
        </IonToolbar>
        {book && !open && hasContractor && (
          <IonToolbar>
            <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value as BookTab)}>
              <IonSegmentButton value="grocery"><IonLabel>البقالة</IonLabel></IonSegmentButton>
              <IonSegmentButton value="contractor"><IonLabel>المقاول</IonLabel></IonSegmentButton>
            </IonSegment>
          </IonToolbar>
        )}
      </IonHeader>
      <IonContent>
        <input
          ref={input} type="file" accept=".json,application/json" hidden
          onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }}
        />

        {!open && (
          <div className="ion-padding">
            <IonButton expand="block" onClick={() => input.current?.click()}>
              {book ? 'فتح ملف آخر' : 'اختيار ملف الدفتر'}
            </IonButton>
            {!book && !error && (
              <div className="empty">
                الملف الذي يرسله المستخدم من «إرسال دفتري للدعم». يُقرأ على هذا الهاتف فقط، ولا يُرفع إلى الخادم.
              </div>
            )}
          </div>
        )}

        {error && <div className="empty">{error}</div>}

        {book && !open && (
          <>
            <div className="acct__meta ion-padding-horizontal">
              جهات: {book.contacts.length} · حركات: {book.entries.length}
              {book.savedAt && <> · حُفظ: <span className="ltr">{dateTime(new Date(book.savedAt).toISOString())}</span></>}
            </div>
            <IonSearchbar value={query} onIonInput={(e) => setQuery(e.detail.value ?? '')} placeholder="بحث بالاسم أو الرقم" />
            {shown.length === 0 && <div className="empty">لا توجد جهات</div>}
            {shown.map((c) => (
              <div key={c.id} className="acct acct--link" role="button" onClick={() => setOpen(c)}>
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
                  حركات: {c.count}
                </div>
              </div>
            ))}
          </>
        )}

        {open && (
          <>
            <div className="acct">
              <div className="acct__top">
                <div>
                  <div className="acct__name">{open.name}</div>
                  <div className="acct__phone">{open.phone}</div>
                </div>
                <span className="badge badge--role">{roleBadge(open.role)}</span>
              </div>
              <div className="acct__meta">
                الرصيد: {open.balances.length === 0 ? 'مسدد' : open.balances.map(balanceText).join(' · ')}
                {open.note && <><br />ملاحظة: {open.note}</>}
              </div>
            </div>
            {entries.length === 0 && <div className="empty">لا توجد حركات</div>}
            {entries.map((t) => (
              <div key={t.id} className="entry">
                <div className="entry__top">
                  <span className={t.type === 'debt' ? 'entry__amt entry__amt--debt' : 'entry__amt entry__amt--pay'}>
                    {t.type === 'debt' ? '+ دين' : '− تسديد'} {money(t.amount, t.currency)}
                  </span>
                  <span className="ltr entry__date">{dateTime(t.occurred_at)}</span>
                </div>
                {t.note && <div className="entry__note">{t.note}</div>}
              </div>
            ))}
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default BookFile;
