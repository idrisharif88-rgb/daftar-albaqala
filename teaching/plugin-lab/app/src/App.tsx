import { Redirect, Route } from 'react-router-dom';
import { IonApp, IonIcon, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { addCircle, grid } from 'ionicons/icons';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import './theme/variables.css';

import { HostProvider } from './lib/HostProvider';
import { LangProvider, useT } from './lib/i18n';
import Apps from './pages/Apps';
import Screen from './pages/Screen';
import Add from './pages/Add';

setupIonicReact();

// Icons only (each has an aria-label for screen readers, in the chosen language).
// Two sections: what I have (open, share, remove) / add one.
const Tabs: React.FC = () => {
  const { t } = useT();
  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route exact path="/apps" component={Apps} />
        <Route exact path="/app/:pluginId/:screenId" component={Screen} />
        <Route exact path="/add" component={Add} />
        <Redirect exact from="/" to="/apps" />
        <Redirect exact from="/plugins" to="/apps" />
        <Redirect exact from="/try" to="/apps" />
      </IonRouterOutlet>
      <IonTabBar slot="bottom">
        <IonTabButton tab="apps" href="/apps" aria-label={t('tab.apps')}><IonIcon icon={grid} /></IonTabButton>
        <IonTabButton tab="add" href="/add" aria-label={t('tab.add')}><IonIcon icon={addCircle} /></IonTabButton>
      </IonTabBar>
    </IonTabs>
  );
};

const App = () => (
  <IonApp>
    <LangProvider>
      <HostProvider>
        <IonReactRouter><Tabs /></IonReactRouter>
      </HostProvider>
    </LangProvider>
  </IonApp>
);

export default App;
