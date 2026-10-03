import { useState } from 'react';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonItem, IonLabel,
  IonInput, IonInputPasswordToggle, IonButton, IonNote, IonSpinner,
} from '@ionic/react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { digitsOnly } from '../lib/digits';

// Three locks: phone, the ADMIN password (not your shop password), and the
// 6-digit code from the authenticator app.
const Login: React.FC = () => {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!phone || !password || code.length !== 6) {
      setError('أدخل الرقم وكلمة المرور ورمز التحقق (٦ أرقام)');
      return;
    }
    setBusy(true);
    try {
      await login(phone, password, code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>مراقب البقالة</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <div className="login-brand">
          <div className="login-brand__name">مراقب البقالة</div>
          <div className="login-brand__tag">لوحة المالك لكل حسابات دفتر البقالة</div>
        </div>
        <form onSubmit={submit}>
          <IonItem>
            <IonLabel position="stacked">رقم الهاتف</IonLabel>
            <IonInput
              type="tel"
              inputmode="tel"
              value={phone}
              onIonInput={(e) => setPhone(digitsOnly(e.detail.value ?? ''))}
              placeholder="7XXXXXXXX"
            />
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">كلمة مرور المالك</IonLabel>
            <IonInput
              type="password"
              value={password}
              onIonInput={(e) => setPassword(e.detail.value ?? '')}
            >
              <IonInputPasswordToggle slot="end" />
            </IonInput>
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">رمز التحقق من تطبيق Authenticator</IonLabel>
            <IonInput
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength={6}
              value={code}
              onIonInput={(e) => setCode(digitsOnly(e.detail.value ?? '').slice(0, 6))}
              placeholder="000000"
              className="code-input"
            />
          </IonItem>
          {error && (
            <IonNote color="danger" className="ion-padding-start login-error">{error}</IonNote>
          )}
          <IonButton expand="block" type="submit" disabled={busy} className="ion-margin-top">
            {busy ? <IonSpinner name="crescent" /> : 'دخول'}
          </IonButton>
        </form>
      </IonContent>
    </IonPage>
  );
};

export default Login;
