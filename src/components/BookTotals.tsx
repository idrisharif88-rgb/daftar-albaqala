import { IonText } from '@ionic/react';
import {
  BASE_CURRENCY, currencyDef, totalInBase, type CurrencyBalance, type Rates,
} from '../data/currencies';
import { formatMinor } from '../data/money';
import { balanceColor } from '../data/roles';

// The whole book in one line, at the bottom of the contact list: how much is
// owed TO the owner, how much the owner owes, and the net between them.
//
// Reported in RIYALS ONLY, on purpose. A book total is a single figure you
// glance at; splitting it per currency the way a contact's balance is split
// would be four numbers that still don't answer "where do I stand". Foreign
// amounts are converted at today's rates — and when a rate is missing the
// total says so rather than quietly understating itself.
//
// Each contact is netted FIRST, then classified. Someone who owes you riyals
// while you owe them gold is one relationship with one direction, not an entry
// on both sides of the book.

interface Props {
  balances: CurrencyBalance[][]; // one entry per contact in scope
  rates: Rates;
}

export const BookTotals: React.FC<Props> = ({ balances, rates }) => {
  let owedToOwner = 0;
  let owedByOwner = 0;
  let complete = true;

  for (const contact of balances) {
    const { minor, complete: converted } = totalInBase(contact, rates);
    if (!converted) complete = false;
    if (minor > 0) owedToOwner += minor;
    else if (minor < 0) owedByOwner += -minor;
  }

  if (owedToOwner === 0 && owedByOwner === 0) return null;

  const net = owedToOwner - owedByOwner;
  const short = currencyDef(BASE_CURRENCY).shortAr;
  const amount = (minor: number) => `${formatMinor(minor)} ${short}`;

  return (
    <div className="book-totals">
      <div className="book-totals-row">
        <IonText color={balanceColor(1)}>
          <span>لك: <strong>{amount(owedToOwner)}</strong></span>
        </IonText>
        <IonText color={balanceColor(-1)}>
          <span>عليك: <strong>{amount(owedByOwner)}</strong></span>
        </IonText>
      </div>
      <IonText color={balanceColor(net)}>
        <div className="book-totals-net">
          الصافي: <strong>{amount(Math.abs(net))}</strong>{' '}
          {net > 0 ? 'لك' : net < 0 ? 'عليك' : 'مسدد'}
        </div>
      </IonText>
      {!complete && (
        <IonText color="medium">
          <div className="book-totals-note">بعض العملات بلا سعر صرف ولم تُحتسب</div>
        </IonText>
      )}
    </div>
  );
};

export default BookTotals;
