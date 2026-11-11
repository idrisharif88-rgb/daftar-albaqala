import { IonIcon, useIonAlert } from '@ionic/react';
import {
  barChartOutline, cardOutline, chatbubblesOutline, cloudUploadOutline, constructOutline,
  peopleOutline, phonePortraitOutline, syncOutline,
} from 'ionicons/icons';
import type { Account } from '../lib/api';

// One row of feature icons on an account card — what is switched on for this
// shop, readable at a glance. Each icon has a state, and the state decides the
// colour (and the words in the legend):
//   on   dark green — switched on and working
//   off  grey       — switched off
//   wait amber — asked, waiting for the user (sync not yet approved)
//   bad  red   — refused by the user
// Tapping the row opens a legend that names every feature and its state, so
// nothing depends on colour alone.

export type FeatureState = 'on' | 'off' | 'wait' | 'bad';

export interface Feature {
  key: string;
  icon: string;
  label: string;
  state: FeatureState;
}

const STATE_AR: Record<FeatureState, string> = {
  on: 'مفعّل', off: 'متوقف', wait: 'بانتظار موافقته', bad: 'رفض',
};

/** The features of one account, in a fixed order. Pure — easy to test. */
export function accountFeatures(a: Account): Feature[] {
  // Sync: the user's answer counts even while it is off — a request waits
  // (amber) or was refused (red) before anything can be switched on.
  const active = a.subscription_status === 'active';
  const sync: FeatureState = a.sync_consent === 'pending' ? 'wait'
    : a.sync_consent === 'rejected' ? 'bad'
      : active ? 'on' : 'off';
  const flag = (on: boolean | undefined): FeatureState => (on ? 'on' : 'off');
  return [
    { key: 'sync', icon: syncOutline, label: 'مزامنة الخادم', state: sync },
    { key: 'drive', icon: cloudUploadOutline, label: 'Google Drive', state: flag(a.drive_backup) },
    { key: 'pos', icon: cardOutline, label: 'نقطة البيع', state: flag(a.pos_enabled) },
    { key: 'staff', icon: peopleOutline, label: 'حسابات الموظفين', state: flag(a.pos_staff_enabled) },
    { key: 'notes', icon: chatbubblesOutline, label: 'الملاحظات', state: flag(a.pos_notes_enabled) },
    { key: 'report', icon: barChartOutline, label: 'تقرير الموظفين', state: flag(a.pos_report_enabled) },
    { key: 'multi', icon: phonePortraitOutline, label: 'عدة أجهزة', state: flag(a.multi_device) },
    { key: 'contractor', icon: constructOutline, label: 'دفتر المقاول', state: flag(a.contractor_status === 'active') },
  ];
}

const FeatureIcons: React.FC<{ account: Account }> = ({ account }) => {
  const [presentAlert] = useIonAlert();
  const features = accountFeatures(account);
  const legend = () => {
    void presentAlert({
      header: account.store_name || account.phone,
      message: features.map((f) => `${f.label}: ${STATE_AR[f.state]}`).join('\n'),
      cssClass: 'feature-legend',
      buttons: ['حسناً'],
    });
  };
  return (
    <button type="button" className="features" onClick={legend} aria-label="الميزات المفعّلة — اضغط للتفاصيل">
      {features.map((f) => (
        <span
          key={f.key}
          className={`feature feature--${f.state}`}
          title={`${f.label}: ${STATE_AR[f.state]}`}
          aria-label={`${f.label}: ${STATE_AR[f.state]}`}
          role="img"
        >
          <IonIcon icon={f.icon} aria-hidden="true" />
        </span>
      ))}
    </button>
  );
};

export default FeatureIcons;
