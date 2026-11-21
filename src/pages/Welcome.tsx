import { IonContent, IonPage, useIonRouter } from '@ionic/react';
import LineIcon, { type LineIconName } from '../components/LineIcon';
import { openWhatsApp, openEmail, openUrl } from '../lib/notify';
import { FLAVOR } from '../flavors';

// The first screen a signed-out user sees — ONE general screen for every kind
// of business (Phase 43, design approved 2026-11-20): no shopping basket, no
// club. What each business type can do is told AFTER sign-in, by its own tour
// (features/tour), once the developer has set the account's type in the
// Watcher. The contact channels stay here: activation is manual, so a new
// account needs them before it can get in.
const WELCOME_WHATSAPP = '779412972';
const WELCOME_CALL = '781215102';
const WELCOME_EMAIL = 'q.fives.app@gmail.com';

const CONTACT_MESSAGE = `مرحباً، لدي استفسار حول تطبيق ${FLAVOR.appName}.`;

const BENEFITS: { icon: LineIconName; title: string; line: string }[] = [
  { icon: 'wallet', title: 'الديون والمدفوعات', line: 'رصيد كل عميل محسوب لحظة بلحظة' },
  { icon: 'msg', title: 'إشعار فوري', line: 'عبر واتساب أو رسالة نصية' },
  { icon: 'shield', title: 'بياناتك محفوظة', line: 'نسخ احتياطي ومزامنة آمنة' },
];

const Welcome: React.FC = () => {
  const router = useIonRouter();

  return (
    <IonPage>
      <IonContent>
        <div className="wl">
          <div className="wl__band">
            <div className="wl__mark"><LineIcon name="book" /></div>
            <h1 className="wl__brand">{FLAVOR.appName}</h1>
            <p className="wl__tag">دفتر حساباتك مع عملائك — منظّم، آمن، ويعمل بدون إنترنت.</p>
          </div>

          <div className="wl__list">
            {BENEFITS.map((b) => (
              <div className="wl__item" key={b.title}>
                <div className="wl__ic"><LineIcon name={b.icon} /></div>
                <div className="wl__tx"><b>{b.title}</b><span>{b.line}</span></div>
              </div>
            ))}
          </div>

          <div className="wl__bottom">
            <button type="button" className="wl__btn wl__btn--solid" onClick={() => router.push('/login')}>
              تسجيل الدخول
            </button>
            <button type="button" className="wl__btn wl__btn--out" onClick={() => router.push('/login?register=1')}>
              إنشاء حساب جديد
            </button>
            <div className="wl__contact">
              <button type="button" onClick={() => void openWhatsApp(WELCOME_WHATSAPP, CONTACT_MESSAGE)}>
                <i><LineIcon name="msg" /></i>واتساب
              </button>
              <button type="button" onClick={() => void openUrl(`tel:+967${WELCOME_CALL}`)}>
                <i><LineIcon name="phone" /></i>اتصال
              </button>
              <button
                type="button"
                onClick={() => void openEmail(WELCOME_EMAIL, `استفسار — ${FLAVOR.appName}`, CONTACT_MESSAGE)}
              >
                <i><LineIcon name="mail" /></i>بريد
              </button>
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Welcome;
