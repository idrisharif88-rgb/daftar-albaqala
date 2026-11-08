import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonList, IonItem, IonLabel, IonText, IonSpinner, IonModal,
  IonInput, IonNote, IonIcon, IonFab, IonCheckbox, IonFabButton, useIonViewWillEnter, useIonAlert,
} from '@ionic/react';
import { add, printOutline, trashOutline, shareSocialOutline } from 'ionicons/icons';
import PosFooter from './PosFooter';
import { Capacitor } from '@capacitor/core';
import {
  listProducts, createProduct, createProducts, exportProductsJson, importProductsJson, updateProduct, deleteProduct, type PosProduct,
} from './products';
import { printLabelsInBrowser, barcodeSvg } from './labels';
import { buildLabelsPdf } from './labelsPdf';
import { sharePdf, printPdfFile } from './pdfPages';
import { toMinor, fromMinor, formatMinor } from '../../data/money';
import { numericInput } from '../../lib/digits';

// «المنتجات» — what the shop sells, each with the barcode label that goes on the
// board. Tapping a product shows its code large; «طباعة الملصقات» prints them
// all. Scanning and the daily summary come in the next steps.
// Dev only: the first customer's real product list, pre-filled in «إضافة قائمة»
// so trying the screen is one tap. Never shipped (import.meta.env.DEV is false
// in a release build).
const SAMPLE_LIST = [
  'ملوج شعير بلدي كبير', 'ملوج شعير بلدي صغير', 'ملوج بر صافي اسمر كبير',
  'خبز تنور بر اسمر صافي', 'خبز طاوه بر اسمر صافي', 'ذمول بر اسمر صافي',
  'ذمول دخن بلدي', 'ذمول شعير بلدي', 'ذمول مشكل حبوب بلدية من جميع الحبوب',
  'ذمول ابيض وأسمر', 'ذمول ابيض',
  'قفوع بلسن بلدي', 'جحين رومي شام بلدي', 'جحين ذره حمراء بلدي',
  'كبانه رومي بلد خالي من الدقيق والسكر',
  'كيك الدخن والشعير البلدي المحلى بدبس التمر الفاخر',
  'كيك البرتقال الطبيعي الأبيض', 'كيك الشكلاه الابيض', 'كيك المكسرات',
  'كيك الطيبات الخالي من الدقيق والبيض والحليب',
  'لحوح ذره بيضاء بلدي خالي من الدقيق',
  'سمن بلدي من ريف اليمن بأنواع المدخن والغير مدخن والمدخن الخفيف وبأحجام مختلفه',
  'خل التفاح البلدي العضوي فرز أول مركز', 'خل العنب الأسود البلدي عضوي فرز أول',
  'خل التفاح فاخر عضوي إيطالي المنشأ', 'خل التفاح العضوي بريطاني المنشأ',
  'عسل السدر بأنواعه الفاخره والعضويه', 'عسل السمر العضوي', 'عسل الطلح العضوي',
  'عسل فرز السدر العضوي', 'عسل مراعي بلدي جبلي فاخر', 'زيت السمسم البلدي العضوي',
].join('\n');

const ProductsPage: React.FC = () => {
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const modal = useRef<HTMLIonModalElement>(null);
  const [editing, setEditing] = useState<PosProduct | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [qr, setQr] = useState('');
  // Which products' labels to print (ids).
  const pickModal = useRef<HTMLIonModalElement>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [presentAlert] = useIonAlert();
  // A second hook: one hook silently ignores present() while its previous
  // alert is still closing (see TodayPage).
  const [presentConfirm] = useIonAlert();

  const load = useCallback(async () => {
    setProducts(await listProducts());
    setLoading(false);
  }, []);
  useIonViewWillEnter(() => { void load(); });

  // The barcode of the open product, drawn on demand.
  useEffect(() => {
    setQr(editing ? barcodeSvg(editing.code) : '');
  }, [editing]);

  const openForm = (p: PosProduct | null) => {
    setEditing(p);
    setName(p?.name ?? '');
    setPrice(p ? String(fromMinor(p.price)) : '');
    setError(null);
    void modal.current?.present();
  };

  const save = async () => {
    setError(null);
    const major = Number(price.replace(',', '.'));
    if (!name.trim()) { setError('اسم المنتج مطلوب'); return; }
    if (!price.trim() || Number.isNaN(major) || major < 0) { setError('أدخل سعراً صحيحاً'); return; }
    setSaving(true);
    try {
      if (editing) await updateProduct(editing.id, { name, price: toMinor(major) });
      else await createProduct({ name, price: toMinor(major) });
      await load();
      await modal.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (p: PosProduct) => {
    presentAlert({
      header: 'حذف المنتج',
      message: `حذف «${p.name}»؟ ملصقه المطبوع سيتوقف عن العمل.`,
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'حذف',
          role: 'destructive',
          handler: () => {
            void (async () => {
              await deleteProduct(p.id);
              await modal.current?.dismiss();
              await load();
            })();
          },
        },
      ],
    });
  };

  // Paste a list, one name per line — for a shop that starts with 30 products.
  const addMany = () => {
    presentAlert({
      header: 'إضافة قائمة منتجات',
      message: 'اكتب اسم كل منتج في سطر. السعر 0 ويمكنك تعديله لاحقاً.',
      inputs: [{
        type: 'textarea', name: 'names', attributes: { rows: 10 },
        value: import.meta.env.DEV ? SAMPLE_LIST : '',
      }],
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'إضافة',
          handler: (v: { names?: string }) => {
            void (async () => {
              const r = await createProducts((v.names ?? '').split('\n'));
              await load();
              presentAlert({
                header: 'تمت الإضافة',
                message: `أضيف ${r.added} منتج` + (r.skipped ? `، وتخطي ${r.skipped} مكرر.` : '.'),
                buttons: ['حسناً'],
              });
            })();
          },
        },
      ],
    });
  };

  // Moving the list to another device (until it syncs): copy as text there,
  // paste it here. Codes travel with the products.
  const copyList = async () => {
    const text = await exportProductsJson();
    try {
      await navigator.clipboard.writeText(text);
      presentAlert({ header: 'تم النسخ', message: 'الصق القائمة في «استيراد» على الجهاز الآخر.', buttons: ['حسناً'] });
    } catch {
      // No clipboard access: show the text so it can be selected by hand.
      presentAlert({ header: 'انسخ هذا النص', message: text, buttons: ['حسناً'] });
    }
  };

  const importList = () => {
    presentAlert({
      header: 'استيراد منتجات',
      message: 'الصق القائمة المنسوخة من الجهاز الآخر (المنتجات والأسعار وكميات اليوم).',
      inputs: [{ type: 'textarea', name: 'text', attributes: { rows: 8 } }],
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        {
          text: 'استيراد',
          handler: (v: { text?: string }) => {
            void (async () => {
              try {
                const r = await importProductsJson(v.text ?? '');
                await load();
                presentConfirm({
                  header: 'تم الاستيراد',
                  message: `أضيف ${r.added} منتج` + (r.skipped ? `، وتخطي ${r.skipped}` : '') + (r.baked ? `، و${r.baked} من كميات اليوم.` : '.'),
                  buttons: ['حسناً'],
                });
              } catch (err) {
                presentConfirm({
                  header: 'تعذّر الاستيراد',
                  message: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
                  buttons: ['حسناً'],
                });
              }
            })();
          },
        },
      ],
    });
  };

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const [working, setWorking] = useState(false);
  const chosen = () => products.filter((p) => picked.has(p.id));
  const fail = (header: string, err: unknown) =>
    presentAlert({
      header,
      message: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
      buttons: ['حسناً'],
    });

  // «طباعة»: the browser's print dialog on a computer; on the phone, Android's
  // own print dialog fed a PDF (any printer it reaches, or «Save as PDF»).
  const printPicked = async () => {
    setWorking(true);
    try {
      if (Capacitor.isNativePlatform()) {
        const { base64, filename } = await buildLabelsPdf(chosen());
        await printPdfFile(base64, filename.replace(/\.pdf$/, ''));
      } else {
        await printLabelsInBrowser(chosen());
      }
      await pickModal.current?.dismiss();
    } catch (err) {
      fail('تعذّرت الطباعة', err);
    } finally {
      setWorking(false);
    }
  };

  // «مشاركة PDF»: for when there is no printer, or it will not connect — send
  // the sheet to WhatsApp, a print shop or a friend who has one.
  const sharePicked = async () => {
    setWorking(true);
    try {
      const { base64, filename } = await buildLabelsPdf(chosen());
      await sharePdf(base64, filename, 'ملصقات المنتجات');
    } catch (err) {
      fail('تعذّرت المشاركة', err);
    } finally {
      setWorking(false);
    }
  };

  const canPrint = products.length > 0;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
          </IonButtons>
          <IonTitle>المنتجات</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={addMany}>إضافة قائمة</IonButton>
            {canPrint && (
              <IonButton onClick={() => { void pickModal.current?.present(); }}>
                <IonIcon slot="start" icon={printOutline} />
                طباعة الملصقات
              </IonButton>
            )}
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            <IonButton fill="clear" size="small" onClick={() => { void copyList(); }}>نسخ المنتجات</IonButton>
            <IonButton fill="clear" size="small" onClick={importList}>استيراد منتجات</IonButton>
          </div>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        {!loading && products.length > 0 && (
          <div className="items-count">عدد المنتجات: {products.length}</div>
        )}
        {loading ? (
          <div className="ion-text-center ion-padding"><IonSpinner name="crescent" /></div>
        ) : products.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">
              لا توجد منتجات بعد. أضف أول منتج بالزر بالأسفل ➕
            </p>
          </IonText>
        ) : (
          <IonList>
            {products.map((p) => (
              <IonItem key={p.id} button onClick={() => openForm(p)}>
                <IonLabel>
                  <h2>{p.name}</h2>
                  <p dir="ltr" style={{ textAlign: 'right' }}>{p.code}</p>
                </IonLabel>
                <IonText slot="end"><strong>{formatMinor(p.price)}</strong></IonText>
              </IonItem>
            ))}
          </IonList>
        )}

        <IonFab slot="fixed" vertical="bottom" horizontal="start">
          <IonFabButton onClick={() => openForm(null)}><IonIcon icon={add} /></IonFabButton>
        </IonFab>

        <IonModal ref={pickModal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>اختر الملصقات للطباعة</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => pickModal.current?.dismiss()}>إغلاق</IonButton>
              </IonButtons>
            </IonToolbar>
            <IonToolbar>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 12px' }}>
                <IonButton fill="clear" size="small"
                  onClick={() => setPicked(new Set(products.map((p) => p.id)))}>تحديد الكل</IonButton>
                <IonButton fill="clear" size="small" onClick={() => setPicked(new Set())}>إلغاء التحديد</IonButton>
              </div>
            </IonToolbar>
          </IonHeader>
          <IonContent>
            <IonList>
              {products.map((p) => (
                <IonItem key={p.id} button onClick={() => togglePick(p.id)}>
                  <IonCheckbox checked={picked.has(p.id)} slot="start" aria-label={p.name} />
                  <IonLabel>{p.name}</IonLabel>
                </IonItem>
              ))}
            </IonList>
          </IonContent>
          <div className="ion-padding">
            <IonButton expand="block" disabled={picked.size === 0 || working} onClick={() => { void printPicked(); }}>
              {working ? <IonSpinner name="crescent" /> : <IonIcon slot="start" icon={printOutline} />}
              طباعة ({picked.size})
            </IonButton>
            <IonButton
              expand="block" fill="outline" disabled={picked.size === 0 || working}
              onClick={() => { void sharePicked(); }}
            >
              <IonIcon slot="start" icon={shareSocialOutline} />
              مشاركة PDF
            </IonButton>
          </div>
        </IonModal>

        <IonModal ref={modal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{editing ? 'تعديل منتج' : 'منتج جديد'}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => modal.current?.dismiss()}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">اسم المنتج</IonLabel>
              <IonInput
                value={name}
                onIonInput={(e) => setName(e.detail.value ?? '')}
                placeholder="مثال: خبز تنور"
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">السعر</IonLabel>
              <IonInput
                type="text"
                inputmode="decimal"
                value={price}
                onIonInput={(e) => setPrice(numericInput(e.detail.value ?? ''))}
                placeholder="0"
              />
            </IonItem>

            {error && (
              <IonNote color="danger" className="ion-padding-start"><IonText>{error}</IonText></IonNote>
            )}

            <IonButton expand="block" onClick={save} disabled={saving} className="ion-margin-top">
              {saving ? <IonSpinner name="crescent" /> : 'حفظ'}
            </IonButton>

            {/* The code is issued once and never edited — it is already on a
                printed label. Shown so the owner can check it against paper. */}
            {editing && (
              <>
                <div
                  style={{ width: 300, maxWidth: '90%', margin: '24px auto 4px', background: '#fff', padding: 10 }}
                  dangerouslySetInnerHTML={{ __html: qr }}
                />
                <IonButton
                  expand="block" fill="clear" color="danger"
                  onClick={() => confirmDelete(editing)}
                >
                  <IonIcon slot="start" icon={trashOutline} />
                  حذف المنتج
                </IonButton>
              </>
            )}
          </IonContent>
        </IonModal>
      </IonContent>
      <PosFooter />
    </IonPage>
  );
};

export default ProductsPage;
