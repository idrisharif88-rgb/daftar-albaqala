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
import Welcome from './pages/Welcome';
import UpdatesNotebook from './pages/UpdatesNotebook';
import BiometricGate from './components/BiometricGate';
import SplashIntro from './components/SplashIntro';
import { AppearanceProvider } from './theme/appearance';
import { AuthProvider, useAuth } from './lib/auth';
import { runSync } from './data/sync';
import { dailyBackupIfDue } from './data/driveBackup';
import { GOOGLE_ENABLED, linkedEmail } from './lib/googleDrive';

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

/* Night mode: Ionic's dark palette, switched by the `.ion-palette-dark` class
 * on <html> (theme/appearance.tsx) — following the phone, not forced. */
import '@ionic/react/css/palettes/dark.class.css';

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

// The daily Google Drive backup — only for an account the owner granted it to,
// and only once the grocer has linked his Google account. On launch and on
// every return to the app; never opens Google's window (a token that cannot be
// renewed silently waits for «نسخ الآن» in Settings).
const DriveDailyBackup: React.FC = () => {
  const { driveBackupAllowed } = useAuth();
  useEffect(() => {
    if (!driveBackupAllowed || !GOOGLE_ENABLED) return undefined;
    const run = () => { if (linkedEmail()) dailyBackupIfDue().catch(() => undefined); };
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    run();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [driveBackupAllowed]);
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
// sent to /welcome — including on logout, so leaving the app lands on the same
// first screen as opening it. Kept inside AuthProvider so useAuth() is available.
const Routes: React.FC = () => {
  const { isAuthenticated, isOwner } = useAuth();
  return (
    // Remount the whole router when signing in or out. IonRouterOutlet keeps a
    // STACK of the pages it has shown; flipping these routes between a page and
    // a <Redirect> leaves the old entry in that stack with nothing to render,
    // which is the blank screen the owner saw after login and logout (a back
    // press rebuilt the stack and the page appeared). A fresh router starts
    // with an empty stack, so the first page it shows is the right one.
    <IonReactRouter key={isAuthenticated ? 'in' : 'out'}>
      <HardwareBack />
      <IonRouterOutlet>
        <Route exact path="/welcome">
          {isAuthenticated ? <Redirect to="/home" /> : <Welcome />}
        </Route>
        <Route exact path="/login">
          {isAuthenticated ? <Redirect to="/home" /> : <Login />}
        </Route>
        <Route exact path="/home">
          {isAuthenticated ? <Home /> : <Redirect to="/welcome" />}
        </Route>
        <Route exact path="/customers/:id">
          {isAuthenticated ? <CustomerDetail /> : <Redirect to="/welcome" />}
        </Route>
        {/* More specific paths come first — a bare /customers/:id would
            otherwise swallow both of these. */}
        <Route exact path="/customers/:id/items">
          {isAuthenticated ? <Items /> : <Redirect to="/welcome" />}
        </Route>
        <Route exact path="/customers/:id/invoice">
          {isAuthenticated ? <Invoice /> : <Redirect to="/welcome" />}
        </Route>
        <Route exact path="/settings">
          {isAuthenticated ? <Settings /> : <Redirect to="/welcome" />}
        </Route>
        {/* The owner's own notebook — no other account can reach it. */}
        <Route exact path="/notebook">
          {isOwner ? <UpdatesNotebook /> : <Redirect to="/home" />}
        </Route>
        <Route exact path="/">
          <Redirect to={isAuthenticated ? '/home' : '/welcome'} />
        </Route>
      </IonRouterOutlet>
    </IonReactRouter>
  );
};

const App: React.FC = () => (
  <IonApp>
    <AppearanceProvider>
      <AuthProvider>
        <AutoSync />
        <DriveDailyBackup />
        <Routes />
        <BiometricGate />
        <SplashIntro />
      </AuthProvider>
    </AppearanceProvider>
  </IonApp>
);

export default App;
