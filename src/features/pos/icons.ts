import {
  add, arrowUndoOutline, checkmarkCircle, bookOutline, cameraOutline, cardOutline, cartOutline, copyOutline,
  downloadOutline, listOutline, pricetagsOutline, printOutline, shareSocialOutline,
  syncOutline, timeOutline, todayOutline, trashOutline, peopleOutline, personCircleOutline, chatbubblesOutline,
  barChartOutline, refreshOutline, fileTrayOutline, chatbubbleEllipsesOutline,
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
  // Sold out — an empty tray, in place of the word «نفد».
  empty: fileTrayOutline,
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
