import { useCallback } from 'react';
import { useIonActionSheet, useIonAlert } from '@ionic/react';
import { getCustomer } from '../data/customers';
import { getBalances, type TxnType } from '../data/transactions';
import { getSettings, messageSender } from '../data/settings';
import { getRates } from '../data/rates';
import type { CurrencyCode } from '../data/currencies';
import { buildMessage, openSms, openWhatsApp, type InvoiceInfo } from './notify';

// Telling the contact what was just recorded — the choice of channel, then the
// "are you sure you don't want to send it" confirmation.
//
// BOTH channels are now a tap. The SMS used to go out by itself, in the
// background, which meant the grocer only had to think about WhatsApp; that
// relied on the SEND_SMS permission, which Google Play will not grant to an app
// that is not the phone's messaging app (see notify.ts). So the sheet offers
// the two channels side by side and the person picks one.
//
// This lives in a hook because TWO screens record entries now: the contact
// screen and the invoice. Duplicating it would mean an invoice that quietly
// stops notifying, or notifies with different wording, the first time one copy
// is changed — and the whole point of the message is that the other person is
// told the same thing every time.
//
// Nothing here can fail the save: the entry is already durable by the time this
// runs, and a contact with no phone or a refused SMS permission must not turn
// a recorded debt into an error.

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
}

export function useContactNotifier(): (input: NotifyInput) => Promise<void> {
  const [presentSheet] = useIonActionSheet();
  const [presentAlert] = useIonAlert();

  // Make sure cancelling the notice was intentional. «تراجع» reopens the send
  // sheet (deferred so this alert has finished dismissing first).
  const confirmCancel = useCallback((phone: string, message: string) => {
    const reopen = () => setTimeout(() => presentSendSheet(phone, message), 350);
    presentAlert({
      header: 'تأكيد الإلغاء',
      message: 'هل أنت متأكد أنك لا تريد إرسال الإشعار للجهة؟',
      buttons: [
        { text: 'تراجع', cssClass: 'alert-btn-send', handler: reopen },
        { text: 'نعم، إلغاء', role: 'cancel', cssClass: 'alert-btn-cancel' },
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentAlert]);

  // The send sheet — WhatsApp, SMS, cancel. The chosen action runs from
  // onDidDismiss (after the sheet has fully closed): both channels leave the
  // app for another one, and the cancel confirmation needs to present without
  // racing the dismiss animation.
  const presentSendSheet = useCallback((phone: string, message: string) => {
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
        if (choice === 'whatsapp') openWhatsApp(phone, message);
        else if (choice === 'sms') openSms(phone, message);
        else confirmCancel(phone, message);
      },
    });
  }, [presentSheet, confirmCancel]);

  return useCallback(async (
    { customerId, type, amount, currency, note, invoice }: NotifyInput,
  ) => {
    const c = await getCustomer(customerId);
    if (!c) return;
    const [settings, newBalances, currentRates] = await Promise.all([
      getSettings(),
      getBalances(customerId),
      getRates(),
    ]);
    if (!settings.notifyCustomers) return; // notifications turned off in Settings
    const message = buildMessage({
      senderName: messageSender(settings),
      role: c.role, // the wording of the whole message follows the contact's role
      type,
      amount,
      currency,
      balances: newBalances,
      rates: currentRates,
      note,
      invoice,
    });
    presentSendSheet(c.phone, message);
  }, [presentSendSheet]);
}
