import { useState } from 'react';
import { useIonAlert, useIonToast } from '@ionic/react';
import { linkedEmail } from './googleDrive';
import {
  backupNow, restoreBackup, readRemoteBackup, isLocalBookEmpty, type RemoteBackup,
} from '../data/driveBackup';

// «نسخ الآن إلى Google Drive», with its safety rules, in ONE place — Settings'
// backup row and the round button on Home (for an account without server
// sync) both use it, so the two can never behave differently.
//
//   - Not linked yet: the tap opens Google's account chooser; picking an
//     account links it and saves. Backing out, or a phone with no Google
//     account, says so plainly (NO_GOOGLE) instead of a vague error.
//   - An empty phone asks before replacing a backup that has a book in it.
//   - Restore merges; it never deletes.

export const NO_GOOGLE = 'أضف حساب جوجل لحفظ بياناتك وحساباتك';
const DRIVE_FAILED = 'تعذّر الوصول إلى Google Drive. تحقق من الاتصال وحاول مجدداً.';

export interface DriveBackupHook {
  backup: () => Promise<void>;
  restore: () => Promise<void>;
  busy: 'backup' | 'restore' | null;
}

/** `onChange` runs after anything that may have changed what Drive holds or
 *  which Google account is linked — the caller refreshes its own display. */
export function useDriveBackup(onChange?: (remote?: RemoteBackup) => void): DriveBackupHook {
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [presentToast] = useIonToast();
  const [presentAlert] = useIonAlert();

  // A failure before any Google account is linked is the Google step itself
  // (chooser cancelled, no account on the phone, Drive not granted).
  const fail = (err: unknown, linkedBefore: boolean) => presentToast({
    message: !linkedBefore && !linkedEmail()
      ? NO_GOOGLE
      : err instanceof Error && /[؀-ۿ]/.test(err.message) ? err.message : DRIVE_FAILED,
    color: !linkedBefore && !linkedEmail() ? 'warning' : 'danger',
    duration: 3500,
  });

  const save = async () => {
    const linkedBefore = !!linkedEmail();
    setBusy('backup');
    try {
      const savedAt = await backupNow({ interactive: true });
      if (savedAt) {
        await presentToast({ message: 'تم حفظ النسخة في Google Drive', color: 'success', duration: 2000 });
      } else {
        await presentToast({ message: NO_GOOGLE, color: 'warning', duration: 3500 });
      }
      onChange?.();
    } catch (err) {
      await fail(err, linkedBefore);
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    const linkedBefore = !!linkedEmail();
    setBusy('restore');
    try {
      const changed = await restoreBackup();
      await presentToast({
        message: changed === null
          ? 'لا توجد نسخة في Google Drive بعد'
          : changed === 0 ? 'الدفتر مطابق للنسخة — لا شيء جديد' : `تمت الاستعادة: ${changed} سجل`,
        color: changed ? 'success' : 'medium',
        duration: 3000,
      });
      onChange?.();
    } catch (err) {
      await fail(err, linkedBefore);
    } finally {
      setBusy(null);
    }
  };

  // An empty phone saving over a backup that has a book in it would replace
  // the grocer's real copy with a blank one — so it asks first.
  const backup = async () => {
    if (busy) return;
    const linkedBefore = !!linkedEmail();
    let ask: RemoteBackup | null = null;
    setBusy('backup');
    try {
      if (await isLocalBookEmpty()) {
        const r = await readRemoteBackup({ interactive: true });
        onChange?.(r);
        if (r.status === 'ok' && !r.summary.isEmpty) ask = r;
      }
    } catch (err) {
      setBusy(null);
      await fail(err, linkedBefore);
      return;
    }
    setBusy(null);
    if (ask?.status !== 'ok') { await save(); return; }
    await presentAlert({
      header: 'الدفتر هنا فارغ',
      message: `في Google Drive نسخة فيها: ${ask.summary.sentence}. ` +
        'الحفظ الآن يستبدلها بدفتر فارغ. الأفضل استعادتها أولاً.',
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        { text: 'استعادة', handler: () => { void restore(); } },
        { text: 'استبدالها', role: 'destructive', handler: () => { void save(); } },
      ],
    });
  };

  return { backup, restore, busy };
}
