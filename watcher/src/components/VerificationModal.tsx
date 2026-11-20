import { useEffect, useState } from 'react';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, IonNote,
  useIonToast,
} from '@ionic/react';
import { logoWhatsapp, chatbubbleEllipsesOutline, copyOutline, refreshOutline } from 'ionicons/icons';
import type { VerificationCode } from '../lib/api';
import { sendBySms, sendByWhatsApp, spacedCode, whatsappMessage } from '../lib/verification';

// Shows a freshly issued verification code ONCE and hands it to WhatsApp or
// the messaging app, already worded. The server never shows it again; closing
// this sheet and issuing another code makes the first one stop working.

interface Props {
  issued: (VerificationCode & { name: string }) | null;
  onClose: () => void;
  onNewCode: () => void;
}

function remaining(expiresAt: string, now: number): string {
  const ms = Math.max(0, new Date(expiresAt).getTime() - now);
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const VerificationModal: React.FC<Props> = ({ issued, onClose, onNewCode }) => {
  const [now, setNow] = useState(Date.now());
  const [presentToast] = useIonToast();

  useEffect(() => {
    if (!issued) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [issued]);

  const expired = issued ? new Date(issued.expires_at).getTime() <= now : false;
  const failed = (what: string) =>
    void presentToast({ message: `تعذّر فتح ${what} على هذا الهاتف`, duration: 2200, color: 'danger' });

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(whatsappMessage(issued.code));
      void presentToast({ message: 'نُسخت الرسالة', duration: 1500, color: 'success' });
    } catch { failed('الحافظة'); }
  };

  return (
    <IonModal isOpen={issued !== null} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>رمز التحقق</IonTitle>
          <IonButtons slot="end"><IonButton onClick={onClose}>إغلاق</IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>
      {issued && (
        <IonContent className="ion-padding">
          <div className="verify">
            <div className="verify__who">{issued.name}</div>
            <div className="verify__phone ltr">{issued.phone}</div>
            <div className={`verify__code ltr${expired ? ' verify__code--dead' : ''}`}>{spacedCode(issued.code)}</div>
            <IonNote color={expired ? 'danger' : 'medium'}>
              {expired ? 'انتهت صلاحية الرمز' : <>ينتهي بعد <span className="ltr">{remaining(issued.expires_at, now)}</span></>}
            </IonNote>

            {!expired ? (
              <div className="verify__send">
                <IonButton expand="block" color="success"
                  onClick={async () => { if (!(await sendByWhatsApp(issued.phone, issued.code))) failed('واتساب'); }}>
                  <IonIcon slot="start" icon={logoWhatsapp} />
                  إرسال عبر واتساب
                </IonButton>
                <IonButton expand="block" fill="outline"
                  onClick={async () => { if (!(await sendBySms(issued.phone, issued.code))) failed('الرسائل'); }}>
                  <IonIcon slot="start" icon={chatbubbleEllipsesOutline} />
                  إرسال برسالة نصية
                </IonButton>
                <IonButton expand="block" fill="clear" onClick={() => void copy()}>
                  <IonIcon slot="start" icon={copyOutline} />
                  نسخ الرسالة
                </IonButton>
              </div>
            ) : (
              <IonButton expand="block" onClick={onNewCode}>
                <IonIcon slot="start" icon={refreshOutline} />
                إنشاء رمز جديد
              </IonButton>
            )}
            <p className="verify__hint">يكتب المستخدم الرمز في التطبيق: الإعدادات ← تأكيد رقم الهاتف.</p>
          </div>
        </IonContent>
      )}
    </IonModal>
  );
};

export default VerificationModal;
