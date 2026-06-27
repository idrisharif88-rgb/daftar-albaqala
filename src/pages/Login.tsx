import { useState } from 'react';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle, IonItem, IonLabel,
  IonInput, IonButton, IonText, IonSegment, IonSegmentButton, IonNote, IonSpinner,
} from '@ionic/react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

type Mode = 'login' | 'register';

// Login / register screen. One form, toggled by a segment. On success the
// AuthProvider stores the JWT and the router (App.tsx) swaps to the home view.
const Login: React.FC = () => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [storeName, setStoreName] = useState('');
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
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(phone.trim(), password);
      } else {
        await register(phone.trim(), password, storeName.trim());
      }
      // Success: AuthProvider flips isAuthenticated; App.tsx routes onward.
    } catch (err) {
      if (err instanceof ApiError) {
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
          <IonTitle>دفتر البقالة</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
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
              onIonInput={(e) => setPhone(e.detail.value ?? '')}
              placeholder="7XXXXXXXX"
            />
          </IonItem>
          <IonItem>
            <IonLabel position="stacked">كلمة المرور</IonLabel>
            <IonInput
              type="password"
              value={password}
              onIonInput={(e) => setPassword(e.detail.value ?? '')}
            />
          </IonItem>

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
