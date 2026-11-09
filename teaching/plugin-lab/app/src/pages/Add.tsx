// Two ways in: a bundled example, or a .plugin.json file from anywhere.
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonHeader, IonPage, IonTitle, IonToast, IonToolbar } from '@ionic/react';
import { checkmarkCircle, alertCircle } from 'ionicons/icons';
import { useRef, useState } from 'react';
import { useHost } from '../lib/HostProvider';
import { examples, type Example } from '../lib/examplePlugin';
import { parseBundle } from '../lib/pluginHost';
import { LangPicker, useT } from '../lib/i18n';

const Add: React.FC = () => {
  const { host, changed } = useHost();
  const { t, error } = useT();
  const picker = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  // A confirmation is a quick tick (1 s); a problem stays long enough to read (3.5 s).
  const run = async (job: () => Promise<string>) => {
    try { setToast({ text: await job(), ok: true }); changed(); }
    catch (e) { setToast({ text: error(e), ok: false }); }
  };
  /** «debt-ledger» → «Debt Ledger» (a name a person would say). */
  const pretty = (id: string) => id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const addExample = (ex: Example) => run(async () => {
    await host.install(await ex.build());
    return t('add.installed', { name: ex.titleKey ? t(ex.titleKey) : ex.title });
  });
  const importFile = (file?: File) => file && run(async () => {
    // Verify BEFORE running anything — a changed file is refused.
    const bundle = await parseBundle(await file.text());
    await host.install(bundle);
    return t('add.imported', { name: pretty(bundle.manifest.id) });
  });

  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>{t('add.title')}</IonTitle><LangPicker /></IonToolbar></IonHeader>
      <IonContent className="ion-padding">
        {examples.map(ex => (
          <IonCard key={ex.id}>
            <IonCardHeader><IonCardTitle>{ex.icon} {ex.titleKey ? t(ex.titleKey) : ex.title}</IonCardTitle></IonCardHeader>
            <IonCardContent>
              {t(`ex.${ex.id}.blurb`)}
              <IonButton expand="block" className="ion-margin-top" onClick={() => addExample(ex)}>{t('add.install')}</IonButton>
            </IonCardContent>
          </IonCard>
        ))}
        <IonCard>
          <IonCardHeader><IonCardTitle>📂 {t('add.fileTitle')}</IonCardTitle></IonCardHeader>
          <IonCardContent>
            {t('add.fileText')}
            <IonButton expand="block" fill="outline" className="ion-margin-top" onClick={() => picker.current?.click()}>{t('add.choose')}</IonButton>
            <input ref={picker} type="file" accept=".json,application/json" hidden
              onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
          </IonCardContent>
        </IonCard>
        <IonToast isOpen={!!toast} message={toast?.text} duration={toast?.ok ? 1000 : 3500} position="middle"
          icon={toast?.ok ? checkmarkCircle : alertCircle} color={toast?.ok ? 'success' : 'danger'} cssClass="toast-pro"
          onDidDismiss={() => setToast(null)} />
      </IonContent>
    </IonPage>
  );
};
export default Add;
