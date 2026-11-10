import { useCallback } from 'react';
import { useIonAlert } from '@ionic/react';
import { checkDebtLimit } from '../data/debtLimit';
import { formatAmountFull, type CurrencyBalance, type CurrencyCode, type Rates } from '../data/currencies';
import type { TxnType } from '../data/transactions';

// Asks the owner before an entry that reaches or passes the contact's debt
// limit. Resolves true to go on recording, false to stop. Past the limit the
// entry is refused unless the owner allows it this once — the limit protects
// the shop, and the owner is the one person who may set it aside.

export interface LimitInput {
  limit: number | null;
  balances: CurrencyBalance[];
  type: TxnType;
  amount: number;
  currency: CurrencyCode;
  rates: Rates;
}

export function useLimitGuard(): (input: LimitInput) => Promise<boolean> {
  const [presentAlert] = useIonAlert();
  return useCallback((i: LimitInput) => {
    const c = checkDebtLimit(i.limit, i.balances, i.type, i.amount, i.currency, i.rates);
    if (c.state === 'ok' || c.limit === null) return Promise.resolve(true);
    const lines =
      `حد الدين: ${formatAmountFull(c.limit, 'YER')}\n` +
      `الرصيد بعد هذه الحركة: ${formatAmountFull(c.after, 'YER')}`;
    return new Promise<boolean>((resolve) => {
      void presentAlert({
        header: c.state === 'over' ? 'تجاوز حد الدين' : 'اقترب من حد الدين',
        message: c.state === 'over'
          ? `${lines}\nلن تُسجَّل الحركة إلا إذا سمحت بها.`
          : lines,
        backdropDismiss: false,
        buttons: [
          { text: 'إلغاء', role: 'cancel', handler: () => resolve(false) },
          {
            text: c.state === 'over' ? 'السماح هذه المرة' : 'متابعة',
            role: c.state === 'over' ? 'destructive' : undefined,
            handler: () => resolve(true),
          },
        ],
      });
    });
  }, [presentAlert]);
}
