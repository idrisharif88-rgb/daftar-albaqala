import { IonButton, IonSpinner } from '@ionic/react';

// The sync-failure indicator: a yellow warning triangle with a black
// exclamation mark, tappable to try the sync again.
//
// Drawn inline rather than using ionicons' `warning`, whose exclamation is a
// knockout — it takes the colour of whatever is behind it, so on this app's
// light toolbar it comes out white. The requirement here is specifically a
// BLACK mark on YELLOW, because that reads as a warning at a glance even to
// someone who isn't reading the screen closely.
//
// Why it exists at all: sync can fail silently in an offline-first app. The
// grocer records a debt, the phone can't reach the server, and nothing on
// screen says the book isn't backed up. This is the standing reminder, and it
// clears itself the moment a sync finishes cleanly.

const WarningTriangle: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 2.6 22.5 20.6a1.6 1.6 0 0 1-1.4 2.4H2.9a1.6 1.6 0 0 1-1.4-2.4L12 2.6Z"
      fill="#F5C518"
      stroke="#8A6D00"
      strokeWidth="1"
      strokeLinejoin="round"
    />
    <rect x="10.9" y="8.4" width="2.2" height="7.2" rx="1.1" fill="#111" />
    <circle cx="12" cy="18.6" r="1.35" fill="#111" />
  </svg>
);

interface Props {
  /** Retry handler — usually the same runSync the manual button uses. */
  onRetry: () => void;
  /** Shows a spinner in place of the triangle while a retry is running. */
  busy?: boolean;
  /** Accessible/tooltip text explaining what went wrong. */
  label?: string;
}

export const SyncWarning: React.FC<Props> = ({ onRetry, busy, label }) => (
  <IonButton
    fill="clear"
    onClick={onRetry}
    disabled={busy}
    title={label ?? 'لم تكتمل المزامنة — اضغط للمحاولة مرة أخرى'}
    aria-label={label ?? 'لم تكتمل المزامنة، اضغط لإعادة المحاولة'}
  >
    {busy ? <IonSpinner name="crescent" /> : <WarningTriangle />}
  </IonButton>
);

// The Arabic explanation for each way a sync can end badly. Kept next to the
// indicator so the toast and the tooltip always say the same thing.
export const SYNC_PROBLEM_TEXT: Record<string, string> = {
  offline: 'لا يوجد اتصال — البيانات محفوظة على الجهاز ولم تُرفع بعد',
  subscription: 'المزامنة تتطلب اشتراكاً فعّالاً',
  error: 'تعذّرت المزامنة، اضغط للمحاولة مرة أخرى',
  partial: 'بعض السجلات لم تُرفع — اضغط للمحاولة مرة أخرى',
};

export default SyncWarning;
