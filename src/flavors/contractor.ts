import type { Flavor } from './types';

// «دفتر المقاول» — the same ledger, kept by a building contractor.
//
// Sign convention is the app's own: `debt` (plus) means the contact owes the
// contractor more, `payment` (minus) means the contractor owes them more.
// `growsType` is the everyday entry — the one that makes what is owed grow.
export const contractor: Flavor = {
  id: 'contractor',
  appName: 'دفتر المقاول',
  tagline: 'العمال والمستخلصات والمواد، في دفتر واحد',
  loginTag: 'حسابات العمال والجهات والمواد بسهولة',
  pitch: 'سجّل أجور العمال والمستخلصات وديون المواد — يعمل بدون إنترنت.',
  // The wheel loader (شيول) scoops sand and tips it into a truck.
  scene: { src: '/splash/loader.html', ms: 6200 },
  // The loader's own colours, fixed: safety orange on the machine's charcoal.
  accents: ['loader'],
  brandColor: '#2B2B2B',
  roles: [
    {
      // The worker. Wages earned put the contractor in debt to him; wages paid
      // and advances (سلفة) both bring it back.
      role: 'worker', labelAr: 'عامل', pluralAr: 'العمال', senderLabelAr: 'المقاول',
      plusAr: 'صرف / سلفة', minusAr: 'أجرة مستحقة',
      plusContactAr: 'استلمت', minusContactAr: 'أجرة مستحقة لك',
      growsType: 'payment',
    },
    {
      // The institution or owner the contractor builds FOR. A certified stage
      // of work (مستخلص) is what they owe; their payment settles it.
      role: 'client', labelAr: 'جهة', pluralAr: 'الجهات', senderLabelAr: 'المقاول',
      plusAr: 'مستخلص', minusAr: 'دفعة مستلمة',
      plusContactAr: 'مستخلص', minusContactAr: 'دفعة مستلمة منكم',
      growsType: 'debt',
    },
    {
      // The intermediary who brought the job. His commission is owed to him.
      role: 'broker', labelAr: 'وسيط', pluralAr: 'الوسطاء', senderLabelAr: 'المقاول',
      plusAr: 'دفعت له', minusAr: 'عمولة مستحقة',
      plusContactAr: 'دفعت لك', minusContactAr: 'عمولة مستحقة لك',
      growsType: 'payment',
    },
    {
      // The materials / tools shop — bought from on credit, like the grocery
      // build's صاحب متجر, so it carries a price list and invoices.
      role: 'materials', labelAr: 'محل مواد', pluralAr: 'محلات المواد', senderLabelAr: 'الزبون',
      plusAr: 'تسديد دفعة', minusAr: 'تسجيل دين',
      plusContactAr: 'تسديد دفعة', minusContactAr: 'تسجيل دين',
      growsType: 'payment',
    },
  ],
  defaultRole: 'worker',
  catalogRoles: ['materials'],
  noticeRoles: ['worker', 'client', 'broker', 'materials'],
};
