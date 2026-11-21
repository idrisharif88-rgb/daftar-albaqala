import { useCallback } from 'react';
import { useIonActionSheet, useIonAlert, useIonRouter, useIonToast } from '@ionic/react';
import { getSettings, messageSender } from '../../data/settings';
import { runSync } from '../../data/sync';
import { formatMinor } from '../../data/money';
import { openSms, openWhatsApp, smsAvailable, whatsappAvailable } from '../../lib/notify';
import { useContactNotifier } from '../../lib/useContactNotifier';
import type { Customer } from '../../data/customers';
import { arabicDate, reminderMessage, subscriptionMessage } from './messages';
import {
  addDays, createSubscription, nextStart, statusOf, subscriptionNote, type ClubSubscription,
} from './subscriptions';

// «تجديد» and «تذكير» for one subscriber (Phase 43, item 6; design approved
// 2026-11-21). Renewal never happens by itself: a confirm, then the same send
// sheet as any entry («no notice, no entry»). A reminder is only a message.

export function useClubActions(onChanged: () => void): {
  renew: (member: Customer, latest: ClubSubscription) => void;
  remind: (member: Customer, latest: ClubSubscription) => void;
} {
  const [presentAlert] = useIonAlert();
  const [presentSheet] = useIonActionSheet();
  const [presentToast] = useIonToast();
  const router = useIonRouter();
  const notifyContact = useContactNotifier();

  const renew = useCallback((member: Customer, latest: ClubSubscription) => {
    const start = nextStart(latest);
    const end = addDays(start, latest.days - 1);
    const input = {
      customerId: member.id, packageName: latest.package_name, days: latest.days,
      listPrice: latest.list_price, price: latest.price, startDate: start,
    };
    presentAlert({
      header: 'تجديد الاشتراك',
      message: `تجديد ${latest.package_name} لـ ${member.name}\n▲ ${arabicDate(start)}   ▼ ${arabicDate(end)}\nالمبلغ ${formatMinor(latest.price)} ر.ي · يُرسل له إشعار`,
      cssClass: 'club-alert',
      buttons: [
        { text: 'إلغاء', role: 'cancel' },
        // Another price (a new discount) → the full form on the card.
        { text: 'تعديل السعر', handler: () => { router.push(`/club/members/${member.id}?renew=1`); } },
        {
          text: 'تجديد', role: 'confirm',
          handler: () => {
            setTimeout(() => {
              void (async () => {
                const commit = async () => { await createSubscription(input); };
                const ok = latest.price > 0
                  ? await notifyContact({
                    customerId: member.id, type: 'debt', amount: latest.price, currency: 'YER',
                    note: subscriptionNote(input), commit,
                    compose: ({ senderName, balanceAfter }) => subscriptionMessage({
                      club: senderName, packageName: latest.package_name, price: latest.price,
                      listPrice: latest.list_price, endDate: end, balanceAfter,
                    }),
                  })
                  : (await commit(), true);
                if (!ok) return;
                void runSync();
                void presentToast({ message: 'تم التجديد ✓', duration: 1600, color: 'success' });
                onChanged();
              })();
            }, 350); // let the alert finish closing before the send sheet opens
          },
        },
      ],
    });
  }, [presentAlert, presentToast, router, notifyContact, onChanged]);

  const remind = useCallback((member: Customer, latest: ClubSubscription) => {
    void (async () => {
      if (!member.phone.trim()) {
        void presentToast({ message: 'لا يوجد رقم لهذا المشترك', duration: 2000, color: 'medium' });
        return;
      }
      const settings = await getSettings();
      const texts = reminderMessage({
        club: messageSender(settings), endDate: latest.end_date, expired: statusOf(latest).status === 'expired',
      });
      let choice: 'whatsapp' | 'sms' | null = null;
      presentSheet({
        header: 'إرسال تذكير',
        buttons: [
          { text: 'عبر واتساب', handler: () => { choice = 'whatsapp'; } },
          { text: 'برسالة نصية', handler: () => { choice = 'sms'; } },
          { text: 'إلغاء', role: 'cancel' },
        ],
        onDidDismiss: () => {
          if (!choice) return;
          const channel = choice;
          void (async () => {
            const available = channel === 'whatsapp' ? await whatsappAvailable() : await smsAvailable();
            const opened = available && (channel === 'whatsapp'
              ? await openWhatsApp(member.phone, texts.whatsapp)
              : await openSms(member.phone, texts.sms));
            if (!opened) {
              void presentToast({
                message: channel === 'whatsapp' ? 'تعذّر فتح واتساب' : 'تعذّر فتح الرسائل',
                duration: 2200, color: 'warning',
              });
            }
          })();
        },
      });
    })();
  }, [presentSheet, presentToast]);

  return { renew, remind };
}
