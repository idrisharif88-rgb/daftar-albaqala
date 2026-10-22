import { ReactElement, useCallback, useRef, useState } from 'react';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonItem, IonLabel, IonInput, IonNote,
} from '@ionic/react';
import { digitsOnly } from './digits';

// The second lock for every change: before a delete / edit / status change the
// owner enters the current 6-digit authenticator code. A modal (not an alert)
// on purpose — the pages already show a confirm alert first, and two alerts
// from the same useIonAlert hook cannot overlap (see CLAUDE.md "Ionic overlay
// trap").
export function useAdminCode(): {
  ask: (title: string) => Promise<string | null>;
  modal: ReactElement;
} {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<(c: string | null) => void>(() => {});
  const settledRef = useRef(false);

  const ask = useCallback((title: string) => new Promise<string | null>((resolve) => {
    resolveRef.current = resolve;
    settledRef.current = false;
    setTitle(title);
    setCode('');
    setError(null);
    setOpen(true);
  }), []);

  const close = useCallback((value: string | null) => {
    if (settledRef.current) return;
    settledRef.current = true;
    resolveRef.current(value);
    setOpen(false);
  }, []);

  const submit = () => {
    if (code.length !== 6) {
      setError('أدخل رمز التحقق (٦ أرقام)');
      return;
    }
    close(code);
  };

  const modal = (
    <IonModal isOpen={open} onDidDismiss={() => close(null)}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{title}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => close(null)}>إلغاء</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonItem>
          <IonLabel position="stacked">رمز التحقق من تطبيق Authenticator</IonLabel>
          <IonInput
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength={6}
            value={code}
            onIonInput={(e) => { setCode(digitsOnly(e.detail.value ?? '').slice(0, 6)); setError(null); }}
            placeholder="000000"
            className="code-input"
          />
        </IonItem>
        {error && <IonNote color="danger" className="ion-padding-start">{error}</IonNote>}
        <p className="hint">كل تغيير يتطلب رمزاً جديداً من تطبيق التحقق.</p>
        <IonButton expand="block" className="ion-margin-top" onClick={submit}>تأكيد</IonButton>
      </IonContent>
    </IonModal>
  );

  return { ask, modal };
}
