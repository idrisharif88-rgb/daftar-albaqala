import { Redirect, Route } from 'react-router-dom';
import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { AuthProvider, useAuth } from './lib/auth';
import Login from './pages/Login';
import Accounts from './pages/Accounts';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';
import './theme/variables.css';
import './theme/watcher.css';

setupIonicReact({ mode: 'md' });

const Routes: React.FC = () => {
  const { authed } = useAuth();
  return (
    <IonRouterOutlet>
      <Route exact path="/login">
        {authed ? <Redirect to="/accounts" /> : <Login />}
      </Route>
      <Route exact path="/accounts">
        {authed ? <Accounts /> : <Redirect to="/login" />}
      </Route>
      <Route exact path="/">
        <Redirect to={authed ? '/accounts' : '/login'} />
      </Route>
    </IonRouterOutlet>
  );
};

const App: React.FC = () => (
  <IonApp>
    <AuthProvider>
      <IonReactRouter>
        <Routes />
      </IonReactRouter>
    </AuthProvider>
  </IonApp>
);

export default App;
