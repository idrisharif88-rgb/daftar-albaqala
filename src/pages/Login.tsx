import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonItem, IonLabel,
  IonInput, IonInputPasswordToggle, IonButton, IonText, IonSegment, IonSegmentButton,
  IonNote, IonSpinner, IonCheckbox,
} from '@ionic/react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { phoneInput } from '../lib/digits';
import { openUrl } from '../lib/notify';
import { PRIVACY_URL } from '../config';
import { FLAVOR } from '../flavors';

type Mode = 'login' | 'register';

// Login / register screen. One form, toggled by a segment. On success the
// AuthProvider stores the JWT and the router (App.tsx) swaps to the home view.
const Login: React.FC = () => {
  const { login, register } = useAuth();
  // The Welcome screen's "new account" button links here with ?register=1.
  const location = useLocation();
  const startRegister = new URLSearchParams(location.search).get('register') === '1';
  const [mode, setMode] = useState<Mode>(startRegister ? 'register' : 'login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [storeName, setStoreName] = useState('');
  // A new account must accept the privacy policy first — it says what the app
  // stores, where it goes, and who can see it. Login does not ask again.
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!phone.trim() || !password) {
      setError('أدخل رقم الهاتف وكلمة المرور');
      return;
    }
    if (mode === 'register' && !storeName.trim()) {
      setError('أدخل اسم المتجر');
      return;
    }
    if (mode === 'register' && !agreed) {
      setError('يجب الموافقة على سياسة الخصوصية لإنشاء حساب');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(phone.trim(), password);
      } else {
        await register(phone.trim(), password, storeName.trim());
      }
      // Success: AuthProvider flips isAuthenticated; App.tsx routes onward.
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // Suspended by the owner from the Watcher app.
        setError('هذا الحساب موقوف. تواصل مع المالك.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('حدث خطأ غير متوقع');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{FLAVOR.appName}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <div className="login-brand">
          <div className="login-brand__name">{FLAVOR.appName}</div>
          <div className="login-brand__tag">{FLAVOR.loginTag}</div>
        </div>
        <IonSegment
          value={mode}
          onIonChange={(e) => { setMode(e.detail.value as Mode); setError(null); }}
        >
          <IonSegmentButton value="login">
            <IonLabel>تسجيل الدخول</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="register">
            <IonLabel>حساب جديد</IonLabel>
          </IonSegmentButton>
        </IonSegment>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <IonItem>
              <IonLabel position="stacked">اسم المتجر</IonLabel>
              <IonInput
                value={storeName}
                onIonInput={(e) => setStoreName(e.detail.value ?? '')}
                placeholder="بقالة النور"
              />
            </IonItem>
          )}
          <IonItem>
            <IonLabel position="stacked">رقم الهاتف</IonLabel>
            <IonInput
              type="tel"
              inputmode="tel"
              value={phone}
              onIonInput={(e) => setPhone(phoneInput(e.detail.value ?? ''))}
              placeholder="7XXXXXXXX"
            />
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">كلمة المرور</IonLabel>
            <IonInput
              type="password"
              value={password}
              onIonInput={(e) => setPassword(e.detail.value ?? '')}
            >
              {/* The eye: a password typed on a phone keyboard is easy to get
                  wrong and impossible to check while it stays dotted — and a
                  wrong one at registration locks the owner out of his own book. */}
              <IonInputPasswordToggle slot="end" />
            </IonInput>
          </IonItem>

          {mode === 'register' && (
            <IonItem lines="none">
              <IonCheckbox
                checked={agreed}
                onIonChange={(e) => setAgreed(e.detail.checked)}
                labelPlacement="end"
                justify="start"
              >
                أوافق على سياسة الخصوصية
              </IonCheckbox>
              {/* Beside the box, not inside its label: a tap on the label
                  toggles the box, so a link there could never just open. */}
              <IonButton slot="end" fill="clear" size="small" onClick={() => void openUrl(PRIVACY_URL)}>
                قراءة
              </IonButton>
            </IonItem>
          )}

          {error && (
            <IonNote color="danger" className="ion-padding-start">
              <IonText>{error}</IonText>
            </IonNote>
          )}

          <IonButton expand="block" type="submit" disabled={busy} className="ion-margin-top">
            {busy ? <IonSpinner name="crescent" /> : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}
          </IonButton>
        </form>
      </IonContent>
    </IonPage>
  );
};

export default Login;
