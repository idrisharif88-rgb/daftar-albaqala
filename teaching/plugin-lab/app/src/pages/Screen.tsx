// Hosts ONE plugin screen. The plugin draws into the <div>; leaving closes it.
import { IonBackButton, IonButtons, IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useHost } from '../lib/HostProvider';
import { LangPicker, useT } from '../lib/i18n';

const Screen: React.FC = () => {
  const { pluginId, screenId } = useParams<{ pluginId: string; screenId: string }>();
  const { host, ready } = useHost();
  const { lang } = useT();
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const title = host.screens().find(s => s.pluginId === pluginId && s.id === screenId)?.title ?? pluginId;

  // The plugin starts in the app's language (the person can still change it inside the plugin).
  // Pluginen starter på appens språk (personen kan fortsatt endre det inne i pluginen).
  useEffect(() => {
    if (!ready || !box.current) return;
    try { return host.mountScreen(pluginId, screenId, box.current, { lang }); }
    catch (e) { setError((e as Error).message); }
  }, [ready, host, pluginId, screenId, lang]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/apps" /></IonButtons>
          <IonTitle>{title}</IonTitle>
          <LangPicker />
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {error && <p className="ion-padding">❌ {error}</p>}
        <div ref={box} style={{ minHeight: '100%' }} />
      </IonContent>
    </IonPage>
  );
};
export default Screen;
