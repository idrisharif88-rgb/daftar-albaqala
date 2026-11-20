import { useEffect, useRef, useState } from 'react';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, IonNote,
} from '@ionic/react';
import { imageOutline, trashOutline } from 'ionicons/icons';

// «شعار المتجر»: pick an image, see it as the shop will (a rounded tile on
// Home), then save. The image is shrunk HERE to ≤ 256 px before it is sent —
// the server keeps it in one column and refuses anything over ~300 KB.

const MAX_SIDE = 256;

/** Image file → JPEG data URL, longest side ≤ MAX_SIDE, on white. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('not an image'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#fff'; // a transparent PNG would turn black in JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface Props {
  /** The account being edited, or null when closed. */
  account: { id: string; name: string; hasLogo: boolean } | null;
  onClose: () => void;
  /** Save (data URL) or remove (null). Resolves when done. */
  onSave: (logo: string | null) => void;
}

const LogoModal: React.FC<Props> = ({ account, onClose, onSave }) => {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setPreview(null); setError(null); }, [account]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try { setPreview(await shrink(file)); } catch { setError('تعذّر فتح الصورة'); }
  };

  return (
    <IonModal isOpen={account !== null} onDidDismiss={onClose} initialBreakpoint={0.7} breakpoints={[0, 0.7, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>شعار المتجر</IonTitle>
          <IonButtons slot="end"><IonButton onClick={onClose}>إغلاق</IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>
      {account && (
        <IonContent className="ion-padding">
          <div className="logo-pick">
            <div className="logo-pick__who">{account.name}</div>
            {preview ? (
              <img className="logo-pick__img" src={preview} alt="الشعار" />
            ) : (
              <div className="logo-pick__empty"><IonIcon icon={imageOutline} /></div>
            )}
            <IonNote>يظهر في أعلى الصفحة الرئيسية لهذا الحساب فقط.</IonNote>
            {error && <IonNote color="danger">{error}</IonNote>}
            <input
              ref={input} type="file" accept="image/*" hidden
              onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }}
            />
            <IonButton expand="block" fill="outline" onClick={() => input.current?.click()}>
              <IonIcon slot="start" icon={imageOutline} />
              اختيار صورة
            </IonButton>
            <IonButton expand="block" disabled={!preview} onClick={() => preview && onSave(preview)}>حفظ</IonButton>
            {account.hasLogo && (
              <IonButton expand="block" fill="clear" color="danger" onClick={() => onSave(null)}>
                <IonIcon slot="start" icon={trashOutline} />
                إزالة الشعار
              </IonButton>
            )}
          </div>
        </IonContent>
      )}
    </IonModal>
  );
};

export default LogoModal;
