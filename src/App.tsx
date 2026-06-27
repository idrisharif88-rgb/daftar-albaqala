import { Redirect, Route } from 'react-router-dom';
import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import Home from './pages/Home';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './lib/auth';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/**
 * Ionic Dark Mode
 * -----------------------------------------------------
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */

/* import '@ionic/react/css/palettes/dark.always.css'; */
/* import '@ionic/react/css/palettes/dark.class.css'; */
import '@ionic/react/css/palettes/dark.system.css';

/* Theme variables */
import './theme/variables.css';

setupIonicReact();

// Routes depend on auth state: signed-in users get the app, everyone else is
// sent to /login. Kept inside AuthProvider so useAuth() is available.
const Routes: React.FC = () => {
  const { isAuthenticated } = useAuth();
  return (
    <IonReactRouter>
      <IonRouterOutlet>
        <Route exact path="/login">
          {isAuthenticated ? <Redirect to="/home" /> : <Login />}
        </Route>
        <Route exact path="/home">
          {isAuthenticated ? <Home /> : <Redirect to="/login" />}
        </Route>
        <Route exact path="/">
          <Redirect to={isAuthenticated ? '/home' : '/login'} />
        </Route>
      </IonRouterOutlet>
    </IonReactRouter>
  );
};

const App: React.FC = () => (
  <IonApp>
    <AuthProvider>
      <Routes />
    </AuthProvider>
  </IonApp>
);

export default App;
