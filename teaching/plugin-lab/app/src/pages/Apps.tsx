// Everything installed, in one list: tap a row to open it; share exports it, the bin removes it.
// (Merged from the old «Plugins» tab.) / Alt som er installert, i én liste.
import { IonButton, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonPage, IonTitle, IonToast, IonToolbar, useIonAlert, useIonRouter } from '@ionic/react';
import { shareOutline, trashOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useHost } from '../lib/HostProvider';
import { shareTextFile } from '../lib/files';
import { LangPicker, useT } from '../lib/i18n';

const Apps: React.FC = () => {
  const { host, ready, changed } = useHost();
  const { t } = useT();
  const router = useIonRouter();
  const [alert] = useIonAlert();
  const [toast, setToast] = useState('');

  const exportIt = async (id: string) => {
    try {
      const { filename, text } = host.exportBundle(id);
      await shareTextFile(filename, text);
    } catch (e) {
      // Backing out of the share sheet is not an error.
      if (!/cancel/i.test((e as Error).message)) setToast((e as Error).message);
    }
  };
  const remove = (id: string) =>
    alert({
      header: t('plugins.removeQ', { id }),
      message: t('plugins.removeMsg'),
      buttons: [
        { text: t('plugins.cancel'), role: 'cancel' },
        { text: t('plugins.remove'), role: 'destructive', handler: () => { host.uninstall(id); changed(); } },
      ],
    });

  const plugins = host.list();
  const screens = host.screens();
  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>{t('apps.title')}</IonTitle><LangPicker /></IonToolbar></IonHeader>
      <IonContent>
        {ready && plugins.length === 0 && host.failed.length === 0 && (
          <div className="empty ion-padding ion-text-center">
            <p>{t('plugins.empty')}</p>
            <IonButton size="large" routerLink="/add">{t('plugins.addOne')}</IonButton>
          </div>
        )}
        <IonList className="apps-list">
          {plugins.map(p => {
            const screen = screens.find(s => s.pluginId === p.id);
            // A plugin with a screen opens it; a command-only plugin has nothing to open (it is for code).
            const open = screen ? () => router.push(`/app/${p.id}/${screen.id}`) : undefined;
            return (
              <IonItem key={p.id} lines="full">
                <span slot="start" style={{ fontSize: 40 }}>{screen?.icon ?? '🧩'}</span>
                <IonLabel className="ion-text-wrap" onClick={open} style={open ? { cursor: 'pointer' } : undefined}>
                  <h2>{screen?.title ?? p.id}</h2>
                  <p>{screen ? p.id : p.commands.join(' · ')}</p>
                </IonLabel>
                <IonButton fill="clear" aria-label={t('plugins.export', { id: p.id })} onClick={() => exportIt(p.id)}><IonIcon slot="icon-only" icon={shareOutline} /></IonButton>
                <IonButton fill="clear" color="danger" aria-label={t('plugins.removeAria', { id: p.id })} onClick={() => remove(p.id)}><IonIcon slot="icon-only" icon={trashOutline} /></IonButton>
              </IonItem>
            );
          })}
          {host.failed.map(f => (
            <IonItem key={f.id} color="light">
              <IonLabel className="ion-text-wrap">
                <h2>{f.id} — {t('plugins.failed')}</h2>
                <p>{f.message}</p>
              </IonLabel>
              <IonButton fill="clear" color="danger" aria-label={t('plugins.removeAria', { id: f.id })} onClick={() => remove(f.id)}><IonIcon slot="icon-only" icon={trashOutline} /></IonButton>
            </IonItem>
          ))}
        </IonList>
        <IonToast isOpen={!!toast} message={toast} duration={3500} onDidDismiss={() => setToast('')} />
      </IonContent>
    </IonPage>
  );
};
export default Apps;
