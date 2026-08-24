import { useCallback } from 'react';
import { useIonActionSheet, useIonAlert } from '@ionic/react';
import { getCustomer } from '../data/customers';
import { getBalances, projectBalances, type TxnType } from '../data/transactions';
import { getSettings, messageSender } from '../data/settings';
import { getRates } from '../data/rates';
import type { CurrencyCode } from '../data/currencies';
import { buildMessage, openSms, openWhatsApp, type InvoiceInfo } from './notify';

// Telling the contact what was just recorded — the choice of channel, then the
// "are you sure you don't want to send it" confirmation.
//
// THE ENTRY IS WRITTEN HERE, not before it. The owner's rule (2026-08-24): no
// notice, no debt. He built a 50-riyal invoice, backed out before choosing a
// channel, and found the debt on the server anyway — recorded, unannounced,
// and impossible to remove, the ledger being append-only. So the caller hands
// over a `commit` and this decides whether it runs: choosing a channel commits
// and then opens it; cancelling commits nothing.
//
// Committing BEFORE opening the channel is deliberate. Opening WhatsApp or the
// messaging app leaves this app, and Android may stop it while it sits in the
// background; the write has to be durable before control is handed away.
//
// The limit worth knowing: this can tell that the channel was OPENED with the
// message filled in, never that the person pressed send inside it. No app can.
//
// BOTH channels are a tap now. The SMS used to go out by itself, in the
// background, which relied on the SEND_SMS permission Google Play will not
// grant a ledger (see notify.ts) — so the sheet offers the two side by side.

export interface NotifyInput {
  customerId: string;
  type: TxnType;
  /** INTEGER minor units. */
  amount: number;
  currency: CurrencyCode;
  /** Folded into the message on its own line. */
  note: string;
  /** Set when the entry is a basket built from the price list: the message
   *  then opens with the invoice — number, date and a line per item — the way
   *  the owner's paper invoice book reads. */
  invoice?: InvoiceInfo;
  /**
   * Writes the entry. Called at most once, and only when the notice is
   * actually going out — or immediately when there is no notice to send
   * (notifications switched off, or a contact with no number).
   */
  commit: () => Promise<void>;
}

/** Resolves true when the entry was committed, false when the owner backed
 *  out — the caller uses it to decide whether to clear the form and leave. */
export function useContactNotifier(): (input: NotifyInput) => Promise<boolean> {
  const [presentSheet] = useIonActionSheet();
  const [presentAlert] = useIonAlert();

  // Make sure cancelling the notice was intentional. «تراجع» reopens the send
  // sheet (deferred so this alert has finished dismissing first).
  const confirmCancel = useCallback((
    phone: string, message: string, commit: () => Promise<void>, done: (ok: boolean) => void,
  ) => {
    const reopen = () => setTimeout(() => presentSendSheet(phone, message, commit, done), 350);
    presentAlert({
      header: 'تأكيد الإلغاء',
      // Says what cancelling costs now: the entry goes with it.
      message: 'إلغاء الإشعار يلغي الحركة أيضاً ولن تُسجَّل. هل أنت متأكد؟',
      buttons: [
        { text: 'تراجع', cssClass: 'alert-btn-send', handler: reopen },
        {
          text: 'نعم، إلغاء',
          role: 'cancel',
          cssClass: 'alert-btn-cancel',
          handler: () => done(false),
        },
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentAlert]);

  // The send sheet — WhatsApp, SMS, cancel. The chosen action runs from
  // onDidDismiss (after the sheet has fully closed): both channels leave the
  // app for another one, and the cancel confirmation needs to present without
  // racing the dismiss animation.
  const presentSendSheet = useCallback((
    phone: string, message: string, commit: () => Promise<void>, done: (ok: boolean) => void,
  ) => {
    let choice: 'whatsapp' | 'sms' | 'cancel' | null = null;
    presentSheet({
      header: 'إرسال إشعار للجهة',
      buttons: [
        { text: 'إرسال عبر واتساب', cssClass: 'as-olive', handler: () => { choice = 'whatsapp'; } },
        { text: 'إرسال برسالة نصية', cssClass: 'as-olive', handler: () => { choice = 'sms'; } },
        { text: 'إلغاء', cssClass: 'as-olive', handler: () => { choice = 'cancel'; } },
      ],
      onDidDismiss: () => {
        // Anything other than an explicit channel — the إلغاء button, the back
        // button, or a backdrop tap — is treated as a cancel and confirmed.
        if (choice !== 'whatsapp' && choice !== 'sms') {
          confirmCancel(phone, message, commit, done);
          return;
        }
        const channel = choice;
        void (async () => {
          try {
            await commit();
          } catch (err) {
            // Nothing was recorded, so nothing may be announced.
            presentAlert({
              header: 'تعذّر حفظ الحركة',
              message: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
              buttons: ['حسناً'],
            });
            done(false);
            return;
          }
          if (channel === 'whatsapp') openWhatsApp(phone, message);
          else openSms(phone, message);
          done(true);
        })();
      },
    });
  }, [presentSheet, confirmCancel, presentAlert]);

  return useCallback(async (
    { customerId, type, amount, currency, note, invoice, commit }: NotifyInput,
  ): Promise<boolean> => {
    const c = await getCustomer(customerId);
    if (!c) return false;
    const [settings, currentBalances, currentRates] = await Promise.all([
      getSettings(),
      getBalances(customerId),
      getRates(),
    ]);

    // No notice to send: notifications turned off in Settings, or a contact
    // with no number. The entry is not held hostage to a message that was
    // never going anywhere.
    if (!settings.notifyCustomers || !c.phone.trim()) {
      await commit();
      return true;
    }

    const message = buildMessage({
      senderName: messageSender(settings),
      role: c.role, // the wording of the whole message follows the contact's role
      type,
      amount,
      currency,
      // What the balance WILL be — the entry has not been written yet.
      balances: projectBalances(currentBalances, type, amount, currency),
      rates: currentRates,
      note,
      invoice,
    });

    return new Promise<boolean>((resolve) => {
      presentSendSheet(c.phone, message, commit, resolve);
    });
  }, [presentSendSheet]);
}
