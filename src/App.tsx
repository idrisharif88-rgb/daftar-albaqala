import { useEffect, useRef } from 'react';
import { Redirect, Route } from 'react-router-dom';
import {
  IonApp, IonRouterOutlet, setupIonicReact, useIonRouter, useIonAlert,
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { App as CapacitorApp } from '@capacitor/app';
import Home from './pages/Home';
import CustomerDetail from './pages/CustomerDetail';
import Items from './pages/Items';
import Invoice from './pages/Invoice';
import Settings from './pages/Settings';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './lib/auth';
import { runSync } from './data/sync';

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

/* Dark mode is intentionally NOT imported: the brand is green-on-white, so we
 * force the light palette (see color-scheme in theme/variables.css). */

/* Theme variables */
import './theme/variables.css';

setupIonicReact();

// Background sync for signed-in users: once on app open, and again whenever the
// network returns. Best-effort and silent — failures (offline, 402) are swallowed
// here; the manual button on Settings surfaces a status. Renders nothing.
const AutoSync: React.FC = () => {
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (!isAuthenticated) return;
    void runSync();
    const onOnline = () => void runSync();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [isAuthenticated]);
  return null;
};

// Android hardware back button: close any open overlay first, otherwise
// navigate to the previous screen. At the root (home / login) there is nowhere
// to go back to, so we ask for confirmation before leaving the app — a proper
// dialog, not a disappearing toast the owner has to catch and act on in 2s.
// Must live inside IonReactRouter so useIonRouter() has the router context.
const HardwareBack: React.FC = () => {
  const router = useIonRouter();
  const [presentAlert] = useIonAlert();
  // One confirmation at a time — repeated back presses must not stack dialogs.
  const confirming = useRef(false);
  useEffect(() => {
    const onBack = (ev: Event) => {
      (ev as CustomEvent).detail.register(10, (_processNext: () => void) => {
        // If an overlay (currency/language popover, a modal, an alert...) is on
        // screen, dismiss IT and stop — otherwise the page navigates back while
        // the overlay stays orphaned on top. We find the topmost visible overlay
        // by checking it's actually rendered (not just present in the DOM). This
        // also means a back press while the exit dialog is open simply closes
        // it — i.e. "stay", which is the safe default.
        const overlays = Array.from(
          document.querySelectorAll<HTMLElement & { dismiss?: () => Promise<unknown> }>(
            'ion-modal, ion-popover, ion-action-sheet, ion-alert, ion-picker'
          )
        );
        const open = overlays.reverse().find(
          (o) => o.offsetWidth > 0 && o.offsetHeight > 0 && typeof o.dismiss === 'function'
        );
        if (open) { void open.dismiss?.(); return; }
        if (router.canGoBack()) { router.goBack(); return; }
        // At the root: confirm before exiting.
        if (confirming.current) return;
        confirming.current = true;
        void presentAlert({
          header: 'إغلاق التطبيق',
          message: 'هل تريد إغلاق دفتر البقالة؟',
          cssClass: 'exit-alert',
          buttons: [
            { text: 'بقاء', role: 'cancel', cssClass: 'alert-stay' },
            {
              text: 'خروج',
              role: 'destructive',
              cssClass: 'alert-exit',
              handler: () => { void CapacitorApp.exitApp(); },
            },
          ],
          onDidDismiss: () => { confirming.current = false; },
        });
      });
    };
    document.addEventListener('ionBackButton', onBack);
    return () => document.removeEventListener('ionBackButton', onBack);
  }, [router]);
  return null;
};

// Routes depend on auth state: signed-in users get the app, everyone else is
// sent to /login. Kept inside AuthProvider so useAuth() is available.
const Routes: React.FC = () => {
  const { isAuthenticated } = useAuth();
  return (
    <IonReactRouter>
      <HardwareBack />
      <IonRouterOutlet>
        <Route exact path="/login">
          {isAuthenticated ? <Redirect to="/home" /> : <Login />}
        </Route>
        <Route exact path="/home">
          {isAuthenticated ? <Home /> : <Redirect to="/login" />}
        </Route>
        <Route exact path="/customers/:id">
          {isAuthenticated ? <CustomerDetail /> : <Redirect to="/login" />}
        </Route>
        {/* More specific paths come first — a bare /customers/:id would
            otherwise swallow both of these. */}
        <Route exact path="/customers/:id/items">
          {isAuthenticated ? <Items /> : <Redirect to="/login" />}
        </Route>
        <Route exact path="/customers/:id/invoice">
          {isAuthenticated ? <Invoice /> : <Redirect to="/login" />}
        </Route>
        <Route exact path="/settings">
          {isAuthenticated ? <Settings /> : <Redirect to="/login" />}
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
      <AutoSync />
      <Routes />
    </AuthProvider>
  </IonApp>
);

export default App;
