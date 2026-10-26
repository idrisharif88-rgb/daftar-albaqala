import { IonContent, IonPage, IonButton, IonIcon, useIonRouter } from '@ionic/react';
import {
  book, receipt, print, chatbubbles, documentText, cloud,
  logoWhatsapp, call, mail, cart, construct,
} from 'ionicons/icons';
import { openWhatsApp, openEmail, openUrl } from '../lib/notify';
import { FLAVOR } from '../flavors';

// The first screen a signed-out grocer sees. It says what the app is for and
// gives a way to reach us — activation is manual, so a new (or suspended)
// account needs the contact channels BEFORE it can get in. Kept to one screen
// (icon tiles, not a scrolling list) and uses FILLED icons: the outline set
// reads as hairlines on a coloured circle. A signed-in grocer never sees this:
// App.tsx sends him to /home.
const WELCOME_WHATSAPP = '779412972';
const WELCOME_CALL = '781215102';
const WELCOME_EMAIL = 'q.fives.app@gmail.com';

const CONTACT_MESSAGE = `مرحباً، لدي استفسار حول تطبيق ${FLAVOR.appName}.`;

const FEATURES = [
  { icon: book, title: 'دفتر الديون' },
  { icon: receipt, title: 'فواتير وأصناف' },
  { icon: print, title: 'طباعة الإيصالات' },
  { icon: chatbubbles, title: 'إشعار واتساب / SMS' },
  { icon: documentText, title: 'كشوف PDF وExcel' },
  { icon: cloud, title: 'مزامنة سحابية' },
];

const Welcome: React.FC = () => {
  const router = useIonRouter();

  return (
    <IonPage>
      <IonContent>
        <div className="welcome">

          <div className="welcome-hero">
            <div className="welcome-logo"><IonIcon icon={FLAVOR.id === 'contractor' ? construct : cart} /></div>
            <h1>{FLAVOR.appName}</h1>
            <p>{FLAVOR.pitch}</p>
          </div>

          <div className="welcome-grid">
            {FEATURES.map((f) => (
              <div className="welcome-tile" key={f.title}>
                <div className="welcome-tile__ic"><IonIcon icon={f.icon} /></div>
                <b>{f.title}</b>
              </div>
            ))}
          </div>

          <div className="welcome-auth">
            <IonButton expand="block" onClick={() => router.push('/login')}>
              تسجيل الدخول
            </IonButton>
            <IonButton expand="block" fill="outline" onClick={() => router.push('/login?register=1')}>
              إنشاء حساب جديد
            </IonButton>
          </div>

          <div className="welcome-contact">
            <div className="welcome-contact__lbl">تواصل معنا</div>
            <div className="welcome-circles">
              <button className="welcome-circ" onClick={() => void openWhatsApp(WELCOME_WHATSAPP, CONTACT_MESSAGE)}>
                <span className="welcome-circ__ic welcome-circ__wa"><IonIcon icon={logoWhatsapp} /></span>
                واتساب
              </button>
              <button className="welcome-circ" onClick={() => void openUrl(`tel:+967${WELCOME_CALL}`)}>
                <span className="welcome-circ__ic welcome-circ__call"><IonIcon icon={call} /></span>
                اتصال
              </button>
              <button
                className="welcome-circ"
                onClick={() => void openEmail(WELCOME_EMAIL, `استفسار — ${FLAVOR.appName}`, CONTACT_MESSAGE)}
              >
                <span className="welcome-circ__ic welcome-circ__mail"><IonIcon icon={mail} /></span>
                بريد
              </button>
            </div>
          </div>

          <div className="welcome-foot">المطور: إدريس أحمد</div>

        </div>
      </IonContent>
    </IonPage>
  );
};

export default Welcome;
