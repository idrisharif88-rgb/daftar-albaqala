import {
  add, arrowUndoOutline, checkmarkCircle, bookOutline, cameraOutline, cardOutline, cartOutline, copyOutline,
  downloadOutline, listOutline, pricetagsOutline, printOutline, shareSocialOutline,
  syncOutline, timeOutline, todayOutline, trashOutline, peopleOutline, personCircleOutline, chatbubblesOutline,
  barChartOutline, refreshOutline, chatbubbleEllipsesOutline,
} from 'ionicons/icons';

// The icons of the app's sections and of the POS section, in ONE place.
//
// One family (Ionicons, outline) so no two shapes clash, and one table so an
// icon is changed here and changes everywhere it is used. The names say what
// the icon MEANS, not what it looks like — «pos» stays «pos» if the picture
// is ever swapped.
//
// An icon on its own tells a screen reader nothing, so every control that
// shows only an icon must also carry a label (`aria-label`) — see `ICON_LABELS`.
/** ∅ — a circle crossed by a diagonal that runs past it. Ionicons has no such
 *  sign, so it is drawn here; `currentColor` lets it take the colour it is
 *  given (red on «اليوم»). */
// Plain markup after ';utf8,' — ionicons parses it as such (no URI-encoding).
const EMPTY_SET = 'data:image/svg+xml;utf8,'
  + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
  + '<circle cx="256" cy="256" r="150" fill="none" stroke="currentColor" stroke-width="40"/>'
  + '<line x1="92" y1="420" x2="420" y2="92" stroke="currentColor" stroke-width="40" stroke-linecap="square"/>'
  + '</svg>';

export const ICONS = {
  debts: bookOutline,
  pos: cardOutline,
  today: todayOutline,
  sell: cartOutline,
  history: timeOutline,
  products: pricetagsOutline,
  copyList: copyOutline,
  importList: downloadOutline,
  addList: listOutline,
  print: printOutline,
  add,
  // The one FILLED icon: it is the day's main action, so it is bigger and heavier.
  confirm: checkmarkCircle,
  trash: trashOutline,
  sync: syncOutline,
  share: shareSocialOutline,
  scan: cameraOutline,
  undo: arrowUndoOutline,
  staff: peopleOutline,
  account: personCircleOutline,
  notes: chatbubblesOutline,
  report: barChartOutline,
  refresh: refreshOutline,
  // Sold out — the empty-set sign ∅ (owner's choice), in place of «نفد».
  empty: EMPTY_SET,
  chat: chatbubbleEllipsesOutline,
} as const;

export type IconName = keyof typeof ICONS;

/** What each icon-only control is called, for screen readers and hover text. */
export const ICON_LABELS: Record<IconName, string> = {
  debts: 'الديون',
  pos: 'نقطة البيع',
  today: 'اليوم',
  sell: 'بيع',
  history: 'السجل',
  products: 'المنتجات',
  copyList: 'نسخ المنتجات',
  importList: 'استيراد منتجات',
  addList: 'إضافة قائمة منتجات',
  print: 'طباعة الملصقات',
  add: 'إضافة',
  confirm: 'اعتماد الكميات',
  trash: 'حذف',
  sync: 'مزامنة',
  share: 'مشاركة',
  scan: 'مسح منتج',
  undo: 'تراجع',
  staff: 'الموظفون',
  account: 'حسابي',
  notes: 'الملاحظات',
  report: 'التقرير',
  refresh: 'تحديث',
  empty: 'نفد',
  chat: 'المحادثة',
};
