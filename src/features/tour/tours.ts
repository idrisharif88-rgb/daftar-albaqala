import type { LineIconName } from '../../components/LineIcon';

// The tour shown once after sign-in, per account type (Phase 43). All of its
// words, icons and colours live HERE, not in the component: a new business
// type is one more entry. Wording and look approved from the design preview
// (2026-11-20).

export type TourType = 'grocery' | 'club';

export interface Tour {
  pill: string;
  icon: LineIconName;
  title: string;
  tagline: string;
  /** CSS class with this tour's colours (variables.css → .tour--<type>). */
  theme: string;
  items: { icon: LineIconName; title: string; line: string }[];
}

export const TOURS: Record<TourType, Tour> = {
  grocery: {
    pill: 'مرحباً بك',
    icon: 'cart',
    title: 'دفتر البقالة',
    tagline: 'كل ما يحتاجه متجرك في مكان واحد.',
    theme: 'tour--grocery',
    items: [
      { icon: 'book', title: 'دفتر الديون', line: 'العملاء والموردون والشركاء' },
      { icon: 'receipt', title: 'فواتير وأصناف', line: 'قائمة أسعار لكل متجر وفاتورة بضغطات' },
      { icon: 'print', title: 'طباعة الإيصالات', line: 'طابعة حرارية أو عادية' },
      { icon: 'file', title: 'كشوف PDF وExcel', line: 'كشف حساب لأي عميل وأي فترة' },
      { icon: 'scan', title: 'نقطة البيع', line: 'بيع بالباركود ومخزون يومي' },
    ],
  },
  club: {
    pill: 'مرحباً كابتن',
    icon: 'dumbbell',
    title: 'دفتر النادي',
    tagline: 'اشتراكات ناديك بلا أوراق ولا نسيان.',
    theme: 'tour--club',
    items: [
      { icon: 'users', title: 'المشتركون', line: 'بيانات كل لاعب ورصيده' },
      { icon: 'tag', title: 'الباقات', line: 'شهرية، أسبوعية، يومية' },
      { icon: 'cal', title: 'تواريخ الاشتراك', line: 'بداية ونهاية واضحة لكل مشترك' },
      { icon: 'bell', title: 'المنتهية وقاربت', line: 'قائمة جاهزة لمن يحتاج تجديد' },
      { icon: 'refresh', title: 'تجديد بضغطة', line: 'مع تأكيد، دون تجديد تلقائي' },
    ],
  },
};

/** The synced setting that remembers this account saw its tour. */
export const tourSeenKey = (type: TourType) => `ui_tour_${type}`;
