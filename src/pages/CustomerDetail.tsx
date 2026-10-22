import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonText, IonSpinner, IonModal,
  IonInput, IonNote, IonGrid, IonRow, IonCol, IonIcon, IonLoading,
  IonSelect, IonSelectOption, IonDatetime, useIonViewWillEnter,
  useIonAlert, useIonActionSheet,
} from '@ionic/react';
import {
  documentTextOutline, createOutline, receiptOutline, pricetagsOutline,
  attachOutline, trashOutline, addOutline, documentOutline, closeOutline,
  logoWhatsapp,
} from 'ionicons/icons';
import { getCustomer, updateCustomer, type Customer } from '../data/customers';
import {
  listTransactions, getBalances, addTransaction, type Transaction, type TxnType,
} from '../data/transactions';
import {
  listAttachments, createAttachment, softDeleteAttachment, getAttachmentData,
  attachmentCounts, type Attachment,
} from '../data/attachments';
import { pickFile, FileTooLargeError } from '../lib/filePicker';
import { compressImage } from '../lib/imageCompress';
import { shareFileViaWhatsApp } from '../lib/shareFile';
import { toMinor } from '../data/money';
import { getSettings, messageSender } from '../data/settings';
import { getRates } from '../data/rates';
import {
  BASE_CURRENCY, CURRENCIES, currencyDef, describeAmount, describeConversion,
  formatAmount, DEFAULT_RATES, type CurrencyBalance, type CurrencyCode, type Rates,
} from '../data/currencies';
import {
  ROLES, directionColor, directionLabel, orderedTypes, roleDef, usesMovementNotice,
  type ContactRole,
} from '../data/roles';
import { peekNoticeNumber, nextNoticeNumber, noticeNote } from '../data/docNumber';
import { isAccountActive, INACTIVE_MESSAGE } from '../data/account';
import { NoShareTargetError, ShareCancelledError } from '../lib/shareTarget';
import { systemPrintAvailable } from '../lib/systemPrint';
import { runSync } from '../data/sync';
import { useContactNotifier } from '../lib/useContactNotifier';
import { FEATURES } from '../config';
import BalanceSummary from '../components/BalanceSummary';
import { numericInput, phoneInput } from '../lib/digits';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// Contact detail — transaction history + record an entry in either direction.
// Append-only (CLAUDE.md): a transaction is never edited or deleted; a
// correction is a reversing entry.
//
// Every entry carries its own CURRENCY, and the currency is part of the debt —
// so the amount field and the history rows both name it explicitly rather than
// assuming riyals.

// The statement's period. The first three are relative to today; the fourth is
// a calendar range the owner picks, held as plain 'YYYY-MM-DD' local days
// (never a UTC instant — «إلى 30 يوليو» has to mean that whole day here, not
// wherever the timestamp was written).
type ExportPeriod = 'day' | 'month' | 'full' | { from: string; to: string };

// What the second export question answers: which file, and where it goes.
type Delivery = 'pdf-share' | 'pdf-print' | 'excel';

/** 'YYYY-MM-DD' in LOCAL time, which is the date shown on the phone. */
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A file chosen in the add-entry form, already compressed, waiting for its entry.
interface PendingFile {
  key: string;
  data: string; // base64
  mime: string;
  filename: string;
  size: number;
}
const MAX_PENDING_FILES = 5;

const CustomerDetail: React.FC = () => {
  const { id: customerId } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [balances, setBalances] = useState<CurrencyBalance[]>([]);
  const [rates, setRates] = useState<Rates>(DEFAULT_RATES);
  const [loading, setLoading] = useState(true);

  // add-transaction modal state. `formType` decides debt vs payment.
  const modal = useRef<HTMLIonModalElement>(null);
  const [formType, setFormType] = useState<TxnType>('debt');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(BASE_CURRENCY);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // edit-contact modal state. The role in particular has to be changeable after
  // the fact: everything the contact reads — «تسجيل دين» vs «أخذت منك» — hangs
  // off it, and contacts created before roles existed are all «زبون».
  const editModal = useRef<HTMLIonModalElement>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editRole, setEditRole] = useState<ContactRole>('customer');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  // A long history takes a few seconds to render into the PDF; without this the
  // screen just sits there and reads as a freeze.
  const [exporting, setExporting] = useState(false);
  // Custom date range for the statement.
  const rangeModal = useRef<HTMLIonModalElement>(null);
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  // Attachments — files pinned to an entry (a product photo, the paper invoice,
  // proof of payment). Shown per history row; a modal lists and manages them.
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const attachModal = useRef<HTMLIonModalElement>(null);
  const [attachTxn, setAttachTxn] = useState<Transaction | null>(null);
  const [attachList, setAttachList] = useState<Attachment[]>([]);
  // Thumbnails, loaded lazily into a map id→dataUrl so the list renders before
  // the (possibly downloaded) bytes arrive.
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [attachBusy, setAttachBusy] = useState(false);
  // Files picked while RECORDING an entry. They live only in the form until the
  // entry itself is written (see `commit` in save) — the entry has no id yet,
  // and cancelling at the send sheet must leave nothing behind.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  // Full-screen image viewer.
  const viewerModal = useRef<HTMLIonModalElement>(null);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  // Synchronous in-flight guard — `saving` state updates a tick late, so a fast
  // double-tap could slip a second (duplicate) transaction through before the
  // button re-renders disabled. The ref blocks the second call immediately.
  const savingRef = useRef(false);
  const [presentAlert] = useIonAlert();
  const [presentSheet] = useIonActionSheet();
  // A SECOND sheet controller, for «إرسال / طباعة». It opens right after the
  // period sheet closes, and Ionic's hook silently ignores present() while its
  // previous overlay is still animating out — sharing one controller made the
  // export button do nothing at all.
  const [presentDeliverySheet] = useIonActionSheet();
  // The SMS + WhatsApp flow, shared with the invoice screen so both tell the
  // contact exactly the same thing.
  const notifyContact = useContactNotifier();

  const load = useCallback(async () => {
    const [c, list, bals, currentRates, attCounts] = await Promise.all([
      getCustomer(customerId),
      listTransactions(customerId),
      getBalances(customerId),
      getRates(),
      attachmentCounts(),
    ]);
    setCustomer(c);
    setTxns(list);
    setBalances(bals);
    setRates(currentRates);
    setCounts(attCounts);
    setLoading(false);
  }, [customerId]);

  useIonViewWillEnter(() => { void load(); });

  const openForm = async (type: TxnType) => {
    if (!(await isAccountActive())) {
      presentAlert({
        header: 'حساب غير مفعّل',
        message: INACTIVE_MESSAGE,
        buttons: ['حسناً'],
      });
      return;
    }
    setFormType(type);
    setAmount('');
    setCurrency(BASE_CURRENCY);
    setNote('');
    setPendingFiles([]);
    setError(null);
    void modal.current?.present();
  };

  const save = async () => {
    setError(null);
    const major = Number(amount.replace(',', '.'));
    if (!amount.trim() || Number.isNaN(major) || major <= 0) {
      setError('أدخل مبلغاً صحيحاً أكبر من صفر');
      return;
    }
    if (savingRef.current) return; // a save is already in flight — ignore the re-tap
    savingRef.current = true;
    setSaving(true);
    try {
      const amountMinor = toMinor(major);
      const entryCurrency = currency;
      // A numbered «إشعار حركة» for the roles that send one. The number is only
      // PEEKED here — it is consumed inside commit, so backing out of the send
      // sheet does not burn one and leave a gap in the series (docNumber.ts).
      const numbered = usesMovementNotice(role);
      const notice = numbered
        ? { number: await peekNoticeNumber(), issuedAt: new Date() }
        : undefined;
      // The entry is NOT written here. It is written by the notifier, and only
      // once the notice is on its way — no notice, no debt (the owner's rule;
      // see useContactNotifier). Backing out of the send sheet leaves the book
      // exactly as it was, which matters because an entry cannot be deleted.
      // Snapshot now: the form state can change before commit runs (the send
      // sheet is open in between).
      const filesToAttach = pendingFiles;
      const commit = async () => {
        // The number goes into the ledger too, not only into the message: it is
        // what the counter reads back after a reinstall, and what the two sides
        // point at when they ask which payment is being talked about.
        const number = numbered ? await nextNoticeNumber() : null;
        const txn = await addTransaction({
          customerId,
          type: formType,
          amount: amountMinor,
          currency: entryCurrency,
          note: number !== null ? noticeNote(number, note) : (note.trim() || null),
        });
        // Pin the files picked in the form to the entry just written. Done here,
        // inside commit, so a cancelled notice saves neither the entry nor them.
        for (const f of filesToAttach) {
          await createAttachment({
            transactionId: txn.id, mime: f.mime, data: f.data,
            filename: f.filename, size: f.size,
          });
        }
        // Push it to the server straight away, but NEVER wait for it: the entry
        // is already saved locally, and the round trip to the droplet is ~400ms
        // on a good link and unbounded on a bad one. Offline it no-ops and the
        // row stays dirty for the next run. `runSync` is single-flight and never
        // throws, so a burst of entries collapses into one run.
        void runSync();
      };
      const recorded = await notifyContact({
        customerId, type: formType, amount: amountMinor,
        currency: entryCurrency, note: note.trim(), notice, commit,
      });
      if (!recorded) return; // cancelled — the form stays open with what was typed
      await load();
      await modal.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  // ---- Edit the contact ----
  //
  // Name, phone, note and role. Changing the role rewrites what both the screen
  // and every future message call the two directions, so the whole page is
  // reloaded afterwards rather than patched in place.
  const openEdit = () => {
    if (!customer) return;
    setEditName(customer.name);
    setEditPhone(customer.phone);
    setEditNote(customer.note ?? '');
    setEditRole(customer.role);
    setEditError(null);
    void editModal.current?.present();
  };

  const saveEdit = async () => {
    setEditError(null);
    if (!editName.trim()) { setEditError('الاسم مطلوب'); return; }
    if (!editPhone.trim()) { setEditError('رقم الهاتف مطلوب'); return; }
    setEditSaving(true);
    try {
      await updateCustomer(customerId, {
        name: editName,
        phone: editPhone,
        note: editNote.trim() || null,
        role: editRole,
      });
      await load();
      void runSync();
      await editModal.current?.dismiss();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setEditSaving(false);
    }
  };

  // Export a PDF statement for this customer. Ask which period first, filter
  // the history by occurred_at, then render + share (see lib/pdf.ts).
  const askExport = () => {
    presentSheet({
      header: 'تصدير كشف حساب',
      buttons: [
        { text: 'اليوم', handler: () => { void doExport('day'); } },
        { text: 'هذا الشهر', handler: () => { void doExport('month'); } },
        { text: 'كل الحركات', handler: () => { void doExport('full'); } },
        { text: 'فترة محددة', handler: () => { openRange(); } },
        { text: 'إلغاء', role: 'cancel' },
      ],
    });
  };

  // Default the picker to this month so far — the commonest ask, and it saves
  // two taps when it is right.
  const openRange = () => {
    const now = new Date();
    setFromDay(localDay(new Date(now.getFullYear(), now.getMonth(), 1)));
    setToDay(localDay(now));
    void rangeModal.current?.present();
  };

  const confirmRange = async () => {
    if (!fromDay || !toDay) return;
    // Picked backwards? Swap rather than scold — the intent is unambiguous.
    const [from, to] = fromDay <= toDay ? [fromDay, toDay] : [toDay, fromDay];
    await rangeModal.current?.dismiss();
    await doExport({ from, to });
  };

  // The second question of an export: which file, and where it goes. Resolved
  // on dismiss, so the back button or a tap outside answers «nowhere». Printing
  // is offered only where it exists (native); Excel always shares/downloads.
  const chooseDelivery = () => new Promise<Delivery | null>((resolve) => {
    let picked: Delivery | null = null;
    const buttons = [
      { text: 'ملف PDF', handler: () => { picked = 'pdf-share'; } },
      ...(systemPrintAvailable()
        ? [{ text: 'طباعة PDF', handler: () => { picked = 'pdf-print' as Delivery; } }]
        : []),
      { text: 'ملف Excel', handler: () => { picked = 'excel'; } },
      { text: 'إلغاء', role: 'cancel' as const },
    ];
    void presentDeliverySheet({
      header: 'صيغة الكشف',
      buttons,
      onDidDismiss: () => resolve(picked),
    });
  });

  const doExport = async (period: ExportPeriod) => {
    if (!customer) return;
    const now = new Date();
    const inPeriod = (iso: string) => {
      if (period === 'full') return true;
      const d = new Date(iso);
      if (period === 'day') return d.toDateString() === now.toDateString();
      if (period === 'month') {
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }
      // Both ends inclusive, compared as local calendar days.
      const day = localDay(d);
      return day >= period.from && day <= period.to;
    };
    const filtered = txns.filter((t) => inPeriod(t.occurred_at));
    const settings = await getSettings();
    const periodLabel = period === 'day' ? 'اليوم'
      : period === 'month' ? 'هذا الشهر'
      : period === 'full' ? 'كل الحركات'
      : `من ${period.from} إلى ${period.to}`;
    // PDF or Excel, shared or printed.
    const delivery = await chooseDelivery();
    if (!delivery) return;
    setExporting(true);
    try {
      const statement = {
        customer,
        transactions: filtered,
        storeName: messageSender(settings),
        ownerName: settings.ownerName,
        rates,
        periodLabel,
      };
      // Loaded on demand — both exporters pull in large dependencies (jspdf /
      // the xlsx writer) that a session which never exports shouldn't parse.
      if (delivery === 'excel') {
        const { exportCustomerStatementXlsx } = await import('../lib/excel');
        await exportCustomerStatementXlsx(statement);
      } else {
        const { exportCustomerStatement, printCustomerStatement } = await import('../lib/pdf');
        if (delivery === 'pdf-print') await printCustomerStatement(statement);
        else await exportCustomerStatement(statement);
      }
    } catch (err) {
      // Backing out of the share sheet is not a failure and gets no dialog.
      if (!(err instanceof ShareCancelledError)) {
        presentAlert({
          header: delivery === 'pdf-print' ? 'تعذّرت الطباعة' : 'خطأ',
          message: err instanceof NoShareTargetError
            ? 'لا يوجد تطبيق يمكنه فتح هذا الملف'
            : delivery === 'pdf-print' && err instanceof Error
              ? err.message
              : delivery === 'excel' ? 'تعذّر إنشاء ملف Excel' : 'تعذّر إنشاء ملف PDF',
          buttons: ['حسناً'],
        });
      }
    } finally {
      setExporting(false);
    }
  };

  // ---- Attachments ----

  const isImage = (mime: string) => mime.startsWith('image/');

  // Load thumbnails for the image attachments in a list (lazy — a pulled file's
  // bytes are fetched on first view; a just-added one is already local).
  const loadThumbs = async (list: Attachment[]) => {
    const next = new Map<string, string>();
    for (const a of list) {
      if (!isImage(a.mime)) continue;
      const data = await getAttachmentData(a.id);
      if (data) next.set(a.id, `data:${a.mime};base64,${data}`);
    }
    setThumbs(next);
  };

  const refreshAttachments = async (txnId: string) => {
    const list = await listAttachments(txnId);
    setAttachList(list);
    setCounts(await attachmentCounts());
    await loadThumbs(list);
  };

  const openAttachments = async (txn: Transaction) => {
    setAttachTxn(txn);
    setAttachList([]);
    setThumbs(new Map());
    await attachModal.current?.present();
    await refreshAttachments(txn.id);
  };

  const addAttachment = async () => {
    if (!attachTxn) return;
    setAttachBusy(true);
    try {
      const picked = await pickFile();
      if (!picked) return; // cancelled
      const squeezed = await compressImage(picked.data, picked.mime);
      await createAttachment({
        transactionId: attachTxn.id,
        mime: squeezed.mime,
        data: squeezed.data,
        filename: picked.filename,
        size: squeezed.size,
      });
      await refreshAttachments(attachTxn.id);
      void runSync(); // upload in the background — the file is already saved locally
    } catch (err) {
      presentAlert({
        header: 'تعذّر إرفاق الملف',
        message: err instanceof FileTooLargeError
          ? 'الملف كبير جداً (الحد ١٢ ميجابايت).'
          : 'حدث خطأ أثناء إرفاق الملف.',
        buttons: ['حسناً'],
      });
    } finally {
      setAttachBusy(false);
    }
  };

  // ---- Files picked while recording an entry ----

  const pickForEntry = async () => {
    if (pendingFiles.length >= MAX_PENDING_FILES) {
      setError(`الحد الأقصى ${MAX_PENDING_FILES} ملفات للحركة الواحدة`);
      return;
    }
    try {
      const picked = await pickFile();
      if (!picked) return; // cancelled
      const squeezed = await compressImage(picked.data, picked.mime);
      setPendingFiles((prev) => [...prev, {
        key: `${Date.now()}-${prev.length}`,
        data: squeezed.data, mime: squeezed.mime,
        filename: picked.filename, size: squeezed.size,
      }]);
      setError(null);
    } catch (err) {
      setError(err instanceof FileTooLargeError
        ? 'الملف كبير جداً (الحد ١٢ ميجابايت).'
        : 'تعذّر إرفاق الملف.');
    }
  };

  const dropPending = (key: string) =>
    setPendingFiles((prev) => prev.filter((f) => f.key !== key));

  const removeAttachment = (att: Attachment) => {
    presentAlert({
      header: 'حذف المرفق',
      message: 'سيُحذف هذا الملف من كل الأجهزة. متابعة؟',
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'حذف',
          role: 'destructive',
          handler: () => {
            void (async () => {
              await softDeleteAttachment(att.id);
              if (attachTxn) await refreshAttachments(attachTxn.id);
              void runSync();
            })();
          },
        },
      ],
    });
  };

  // Open an attachment: an image goes to the in-app viewer; anything else
  // (a PDF) is handed to the OS — opened in a new tab on web, shared out to a
  // viewer on the phone.
  const openAttachment = async (att: Attachment) => {
    const data = await getAttachmentData(att.id);
    if (!data) {
      presentAlert({
        header: 'غير متاح',
        message: 'هذا الملف غير متاح بدون اتصال بالإنترنت.',
        buttons: ['حسناً'],
      });
      return;
    }
    if (isImage(att.mime)) {
      setViewerSrc(`data:${att.mime};base64,${data}`);
      void viewerModal.current?.present();
      return;
    }
    if (Capacitor.getPlatform() === 'web') {
      const win = window.open();
      if (win) win.document.write(
        `<iframe src="data:${att.mime};base64,${data}" style="border:0;width:100%;height:100%"></iframe>`,
      );
      return;
    }
    try {
      const name = att.filename || 'attachment';
      const written = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
      await Share.share({ title: name, url: written.uri });
    } catch {
      // No viewer / backed out — not worth a red dialog.
    }
  };

  // Share one attachment, WhatsApp first (the grocer picks the chat — WhatsApp
  // can't both pre-select a contact and carry a file). Deliberately on demand,
  // not automatic: attaching a file and sending it are different acts.
  const shareAttachment = async (att: Attachment) => {
    const data = await getAttachmentData(att.id);
    if (!data) {
      presentAlert({
        header: 'غير متاح',
        message: 'هذا الملف غير متاح بدون اتصال بالإنترنت.',
        buttons: ['حسناً'],
      });
      return;
    }
    try {
      const settings = await getSettings();
      await shareFileViaWhatsApp({
        data,
        mime: att.mime,
        filename: att.filename || (isImage(att.mime) ? 'صورة.jpg' : 'ملف'),
        caption: messageSender(settings),
      });
    } catch (err) {
      // Backing out of the share sheet is not a failure.
      if (!(err instanceof ShareCancelledError)) {
        presentAlert({
          header: 'تعذّرت المشاركة',
          message: err instanceof NoShareTargetError
            ? 'لا يوجد تطبيق يمكنه مشاركة هذا الملف'
            : 'حدث خطأ أثناء المشاركة.',
          buttons: ['حسناً'],
        });
      }
    }
  };

  // Button/label wording follows the contact's role: recording «دين» against a
  // shop you buy from reads backwards, so each role names its two directions.
  // The order and the colours follow it too — for a صاحب متجر the debt-growing
  // entry is the 'payment' one, and it still has to be the red button on the
  // right, or a new debt shows up green.
  const role = customer?.role ?? 'customer';
  const [firstType, secondType] = orderedTypes(role);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" text="رجوع" />
          </IonButtons>
          <IonTitle>{customer?.name ?? 'جهة'}</IonTitle>
          <IonButtons slot="end">
            {/* Owner build only — see FEATURES.editContacts in config.ts. */}
            {FEATURES.editContacts && (
              <IonButton onClick={openEdit} disabled={!customer}>
                <IonIcon slot="icon-only" icon={createOutline} />
              </IonButton>
            )}
            <IonButton onClick={askExport} disabled={!customer}>
              <IonIcon slot="icon-only" icon={documentTextOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        {loading ? (
          <div className="ion-text-center ion-padding">
            <IonSpinner name="crescent" />
          </div>
        ) : !customer ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">الجهة غير موجودة.</p>
          </IonText>
        ) : (
          <>
            {/* Balance summary — one line per currency in play, plus a YER
                equivalent at today's rates when there is more than one. */}
            <div className="balance-card">
              <div className="balance-card__label">
                الرصيد الحالي · {roleDef(role).labelAr}
              </div>
              <BalanceSummary balances={balances} rates={rates} align="center" />
            </div>

            {/* The two directions, everyday one first, named for this role */}
            <IonGrid>
              <IonRow>
                {[firstType, secondType].map((t) => (
                  <IonCol key={t}>
                    <IonButton
                      expand="block"
                      color={directionColor(role, t)}
                      onClick={() => openForm(t)}
                    >
                      {directionLabel(role, t)}
                    </IonButton>
                  </IonCol>
                ))}
              </IonRow>
              {/* A price list and an invoice only make sense against a SHOP —
                  a صاحب متجر is the one you buy goods from. A زبون or a شريك
                  has debts, not a catalogue, and putting the buttons there
                  would be two dead ends on every contact screen. */}
              {role === 'supplier' && (
                <IonRow>
                  <IonCol>
                    <IonButton
                      expand="block"
                      fill="outline"
                      routerLink={`/customers/${customerId}/invoice`}
                    >
                      <IonIcon slot="start" icon={receiptOutline} />
                      فاتورة
                    </IonButton>
                  </IonCol>
                  <IonCol>
                    <IonButton
                      expand="block"
                      fill="outline"
                      routerLink={`/customers/${customerId}/items`}
                    >
                      <IonIcon slot="start" icon={pricetagsOutline} />
                      الأصناف
                    </IonButton>
                  </IonCol>
                </IonRow>
              )}
            </IonGrid>

            {/* History — newest first */}
            {txns.length === 0 ? (
              <IonText color="medium">
                <p className="ion-text-center ion-padding">لا توجد حركات بعد.</p>
              </IonText>
            ) : (
              <IonList>
                {txns.map((t) => (
                  <IonItem key={t.id}>
                    <IonLabel>
                      <h2 style={{ color: `var(--ion-color-${directionColor(role, t.type)})` }}>
                        {directionLabel(role, t.type)}
                      </h2>
                      {t.note && <p>{t.note}</p>}
                      <p>{new Date(t.occurred_at).toLocaleString('ar')}</p>
                    </IonLabel>
                    <IonText slot="end" color={directionColor(role, t.type)}>
                      <div style={{ textAlign: 'end' }}>
                        <strong>{formatAmount(t.amount, t.currency)}</strong>
                        {/* Foreign-currency and gold entries also show what they
                            are worth today — the native figure stays the record. */}
                        {describeConversion(t.amount, t.currency, rates) && (
                          <div style={{ fontSize: '0.7em', opacity: 0.8 }}>
                            {describeConversion(t.amount, t.currency, rates)}
                          </div>
                        )}
                      </div>
                    </IonText>
                    {/* Files pinned to this entry — tap to view or add. */}
                    <button
                      type="button"
                      slot="end"
                      className={`att-btn${counts.get(t.id) ? ' att-btn--has' : ''}`}
                      onClick={(e) => { e.stopPropagation(); void openAttachments(t); }}
                      aria-label="مرفقات"
                    >
                      <IonIcon icon={attachOutline} />
                      {counts.get(t.id) ? (
                        <span className="att-btn__n">{counts.get(t.id)}</span>
                      ) : null}
                    </button>
                  </IonItem>
                ))}
              </IonList>
            )}
          </>
        )}

        <IonModal ref={modal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{directionLabel(role, formType)}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => modal.current?.dismiss()}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">العملة</IonLabel>
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
              <IonLabel position="stacked">
                {currencyDef(currency).isWeight ? 'الوزن بالجرام' : `المبلغ (${currencyDef(currency).shortAr})`}
              </IonLabel>
              <IonInput
                type="text"
                inputmode="decimal"
                value={amount}
                onIonInput={(e) => setAmount(numericInput(e.detail.value ?? ''))}
                placeholder="0"
              />
            </IonItem>
            {/* Live conversion while typing, so the owner sees what the entry is
                worth in riyals before committing to it. */}
            {currency !== BASE_CURRENCY && Number(amount.replace(',', '.')) > 0 && (
              <IonNote className="ion-padding-start">
                <IonText color="medium">
                  {describeAmount(toMinor(Number(amount.replace(',', '.'))), currency, rates)}
                </IonText>
              </IonNote>
            )}
            <IonItem>
              <IonLabel position="stacked">ملاحظة (اختياري)</IonLabel>
              <IonInput
                value={note}
                onIonInput={(e) => setNote(e.detail.value ?? '')}
              />
            </IonItem>

            {/* Files to pin to this entry (a product photo, the paper invoice,
                proof of payment). Saved with the entry, not before it. */}
            <div className="entry-files">
              <button
                type="button"
                className="entry-files__add"
                onClick={() => { void pickForEntry(); }}
                disabled={saving}
              >
                <IonIcon icon={attachOutline} />
                <span>إرفاق ملف</span>
              </button>
              {pendingFiles.map((f) => (
                <div key={f.key} className="entry-files__chip">
                  {f.mime.startsWith('image/') ? (
                    <img src={`data:${f.mime};base64,${f.data}`} alt="" />
                  ) : (
                    <IonIcon icon={documentOutline} />
                  )}
                  <span className="entry-files__name">{f.filename || 'ملف'}</span>
                  <button
                    type="button"
                    className="entry-files__x"
                    onClick={() => dropPending(f.key)}
                    disabled={saving}
                    aria-label="إزالة"
                  >
                    <IonIcon icon={closeOutline} />
                  </button>
                </div>
              ))}
            </div>

            {error && (
              <IonNote color="danger" className="ion-padding-start">
                <IonText>{error}</IonText>
              </IonNote>
            )}

            <IonButton
              expand="block"
              color={directionColor(role, formType)}
              onClick={save}
              disabled={saving}
              className="ion-margin-top"
            >
              {saving ? <IonSpinner name="crescent" /> : 'حفظ'}
            </IonButton>
          </IonContent>
        </IonModal>

        {/* Edit the contact — including its role, which decides the wording of
            every message this contact receives from here on. Not mounted at all
            outside the owner build, so there is no way to reach it. */}
        {FEATURES.editContacts && (
        <IonModal ref={editModal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>تعديل الجهة</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => editModal.current?.dismiss()}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">الاسم</IonLabel>
              <IonInput
                value={editName}
                onIonInput={(e) => setEditName(e.detail.value ?? '')}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">رقم الهاتف</IonLabel>
              <IonInput
                type="tel"
                inputmode="tel"
                value={editPhone}
                onIonInput={(e) => setEditPhone(phoneInput(e.detail.value ?? ''))}
              />
            </IonItem>
            <IonItem>
              <IonLabel>الصفة</IonLabel>
              <IonSelect
                value={editRole}
                onIonChange={(e) => setEditRole(e.detail.value as ContactRole)}
                interface="popover"
              >
                {ROLES.map((r) => (
                  <IonSelectOption key={r.role} value={r.role}>{r.labelAr}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">ملاحظة (اختياري)</IonLabel>
              <IonInput
                value={editNote}
                onIonInput={(e) => setEditNote(e.detail.value ?? '')}
              />
            </IonItem>

            <IonNote color="medium" className="ion-padding-start">
              <IonText>
                تغيير الصفة يغيّر تسمية الحركات ونص الرسائل المرسلة لهذه الجهة،
                ولا يغيّر الأرصدة ولا الحركات المسجّلة.
              </IonText>
            </IonNote>

            {editError && (
              <IonNote color="danger" className="ion-padding-start">
                <IonText>{editError}</IonText>
              </IonNote>
            )}

            <IonButton
              expand="block"
              onClick={saveEdit}
              disabled={editSaving}
              className="ion-margin-top"
            >
              {editSaving ? <IonSpinner name="crescent" /> : 'حفظ'}
            </IonButton>
          </IonContent>
        </IonModal>
        )}

        {/* Custom statement range. Two date pickers, both ends inclusive. */}
        <IonModal ref={rangeModal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>فترة محددة</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => rangeModal.current?.dismiss()}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonLabel className="ion-padding-start"><h2>من تاريخ</h2></IonLabel>
            <IonDatetime
              presentation="date"
              value={fromDay}
              onIonChange={(e) => setFromDay(String(e.detail.value ?? '').slice(0, 10))}
            />
            <IonLabel className="ion-padding-start"><h2>إلى تاريخ</h2></IonLabel>
            <IonDatetime
              presentation="date"
              value={toDay}
              onIonChange={(e) => setToDay(String(e.detail.value ?? '').slice(0, 10))}
            />
            <IonButton expand="block" className="ion-margin-top" onClick={confirmRange}>
              إنشاء الكشف
            </IonButton>
          </IonContent>
        </IonModal>

        {/* Attachments for one entry — list, add, view, delete. */}
        <IonModal ref={attachModal} onDidDismiss={() => setAttachTxn(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>مرفقات الحركة</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => attachModal.current?.dismiss()}>إغلاق</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonButton expand="block" onClick={addAttachment} disabled={attachBusy}>
              {attachBusy ? (
                <IonSpinner name="crescent" />
              ) : (
                <>
                  <IonIcon slot="start" icon={addOutline} />
                  إضافة ملف (صورة أو PDF)
                </>
              )}
            </IonButton>
            <IonNote color="medium" className="ion-padding-start">
              <IonText>
                <p>لإرفاق صورة منتج أو فاتورة: التقطها بالكاميرا ثم اخترها من المعرض.</p>
              </IonText>
            </IonNote>

            {attachList.length === 0 ? (
              <IonText color="medium">
                <p className="ion-text-center ion-padding">لا توجد مرفقات بعد.</p>
              </IonText>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
                {attachList.map((a) => (
                  <div key={a.id} style={{ position: 'relative', width: 120 }}>
                    <div
                      onClick={() => { void openAttachment(a); }}
                      style={{
                        cursor: 'pointer', height: 120, borderRadius: 8, overflow: 'hidden',
                        background: '#fff', border: '1px solid var(--ion-color-light-shade)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {isImage(a.mime) && thumbs.get(a.id) ? (
                        <img
                          src={thumbs.get(a.id)}
                          alt={a.filename}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <IonIcon icon={documentOutline} style={{ fontSize: 40, color: 'var(--ion-color-medium)' }} />
                      )}
                    </div>
                    <div style={{
                      fontSize: 12, textAlign: 'center', marginTop: 4,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {a.filename || (isImage(a.mime) ? 'صورة' : 'ملف')}
                    </div>
                    {/* Share this file — WhatsApp first; you pick the chat. */}
                    <IonButton
                      fill="solid"
                      color="success"
                      size="small"
                      onClick={() => { void shareAttachment(a); }}
                      aria-label="مشاركة عبر واتساب"
                      style={{ position: 'absolute', top: -8, insetInlineStart: -8, '--padding-start': '6px', '--padding-end': '6px' } as React.CSSProperties}
                    >
                      <IonIcon slot="icon-only" icon={logoWhatsapp} />
                    </IonButton>
                    <IonButton
                      fill="solid"
                      color="danger"
                      size="small"
                      onClick={() => removeAttachment(a)}
                      aria-label="حذف المرفق"
                      style={{ position: 'absolute', top: -8, insetInlineEnd: -8, '--padding-start': '6px', '--padding-end': '6px' } as React.CSSProperties}
                    >
                      <IonIcon slot="icon-only" icon={trashOutline} />
                    </IonButton>
                  </div>
                ))}
              </div>
            )}
          </IonContent>
        </IonModal>

        {/* Full-screen image viewer. */}
        <IonModal ref={viewerModal} onDidDismiss={() => setViewerSrc(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>عرض الصورة</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => viewerModal.current?.dismiss()}>
                  <IonIcon slot="icon-only" icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent>
            <div style={{
              width: '100%', height: '100%', background: '#000',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {viewerSrc && (
                <img src={viewerSrc} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              )}
            </div>
          </IonContent>
        </IonModal>

        <IonLoading isOpen={exporting} message="جارٍ إنشاء الكشف..." />
      </IonContent>
    </IonPage>
  );
};

export default CustomerDetail;
