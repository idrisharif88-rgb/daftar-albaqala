import { IonText } from '@ionic/react';
import {
  BASE_CURRENCY, currencyDef, formatAmount, totalInBase,
  type CurrencyBalance, type Rates,
} from '../data/currencies';
import { formatMinor } from '../data/money';
import { balanceColor, ownerBalanceLabel } from '../data/roles';

// A contact's balance, which since multi-currency is a LIST, not a number: a
// debt in riyals and a debt in gold are different debts and never add up. So
// every currency in play gets its own line, and the YER figure underneath is a
// convenience total at today's rates — explicitly marked «بأسعار اليوم» so it
// is never mistaken for the debt itself.
//
// Shared by the contact list and the detail screen so the two can't disagree
// about what a balance looks like or which way round it reads.

interface Props {
  balances: CurrencyBalance[];
  rates: Rates;
  /** Compact fits a list row; the full form is for the detail header. */
  compact?: boolean;
  /** List rows align to the row's end; the detail card is centred. */
  align?: 'end' | 'center';
  slot?: string;
}

// Direction is per currency: someone can owe you riyals while you owe them
// gold, so each line carries its own «عليه»/«عليك» rather than one verdict for
// the whole contact.
export const BalanceSummary: React.FC<Props> = ({
  balances, rates, compact, align = 'end', slot,
}) => {
  if (balances.length === 0) {
    return (
      <IonText slot={slot} color="medium">
        <div style={{ textAlign: align }}>
          <strong>مسدد</strong>
        </div>
      </IonText>
    );
  }

  const { minor: totalMinor, complete } = totalInBase(balances, rates);
  // Only worth showing a combined figure when there is something to combine.
  const showTotal = balances.length > 1 && (totalMinor !== 0 || complete);
  const baseShort = currencyDef(BASE_CURRENCY).shortAr;

  return (
    <div slot={slot} style={{ textAlign: align }}>
      {balances.map((b) => (
        <IonText key={b.currency} color={balanceColor(b.minor)}>
          <div style={{ fontSize: compact ? '0.95em' : '1.1em' }}>
            <strong>{formatAmount(Math.abs(b.minor), b.currency)}</strong>
            <span style={{ fontSize: '0.75em', marginInlineStart: 6 }}>
              {ownerBalanceLabel(b.minor)}
            </span>
          </div>
        </IonText>
      ))}

      {showTotal && (
        <IonText color="medium">
          <div style={{ fontSize: '0.72em', marginTop: 2 }}>
            ≈ {formatMinor(Math.abs(totalMinor))} {baseShort} {ownerBalanceLabel(totalMinor)}
            {complete ? ' بأسعار اليوم' : ' (بعض الأسعار غير محدّدة)'}
          </div>
        </IonText>
      )}
    </div>
  );
};

export default BalanceSummary;
