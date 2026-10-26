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
  driveBackupFile: 'daftar-contractor-backup.json',
  nameKeys: { store: 'contractor_store_name', owner: 'contractor_owner_name' },
  roles: [
    {
      // The worker. Wages earned put the contractor in debt to him; wages paid
      // and advances (سلفة) both bring it back.
      role: 'worker', labelAr: 'عامل', pluralAr: 'العمال', senderLabelAr: 'المقاول',
      plusAr: 'صرف / سلفة', minusAr: 'أجرة مستحقة',
      plusContactAr: '💵 استلمت من المقاول', minusContactAr: '✅ أُضيفت إلى أجرك',
      growsType: 'payment',
      balanceSentence: {
        heading: 'حسابك الآن',
        weOwe: (a) => `المقاول مدين لك بـ ${a} من أجرك`,
        theyOwe: (a) => `عليك للمقاول ${a} (استلمت أكثر من أجرك)`,
        settled: 'حسابك مع المقاول مسدد ✔',
      },
    },
    {
      // The institution or owner the contractor builds FOR. A certified stage
      // of work (مستخلص) is what they owe; their payment settles it.
      role: 'client', labelAr: 'جهة', pluralAr: 'الجهات', senderLabelAr: 'المقاول',
      plusAr: 'مستخلص', minusAr: 'دفعة مستلمة',
      plusContactAr: '📄 مستخلص أعمال منفّذة', minusContactAr: '💵 استلم المقاول منكم دفعة',
      growsType: 'debt',
      balanceSentence: {
        heading: 'الحساب الآن',
        theyOwe: (a) => `المتبقي عليكم للمقاول ${a}`,
        weOwe: (a) => `لكم عند المقاول ${a} (دفعتم أكثر من المستخلصات)`,
        settled: 'الحساب مسدد ✔',
      },
    },
    {
      // The intermediary who brought the job. His commission is owed to him.
      role: 'broker', labelAr: 'وسيط', pluralAr: 'الوسطاء', senderLabelAr: 'المقاول',
      plusAr: 'دفعت له', minusAr: 'عمولة مستحقة',
      plusContactAr: '💵 استلمت من المقاول', minusContactAr: '✅ أُضيفت إلى عمولتك',
      growsType: 'payment',
      balanceSentence: {
        heading: 'حسابك الآن',
        weOwe: (a) => `المقاول مدين لك بـ ${a} من عمولتك`,
        theyOwe: (a) => `عليك للمقاول ${a} (استلمت أكثر من عمولتك)`,
        settled: 'حسابك مع المقاول مسدد ✔',
      },
    },
    {
      // The materials / tools shop — bought from on credit, like the grocery
      // build's صاحب متجر, so it carries a price list and invoices.
      role: 'materials', labelAr: 'محل مواد', pluralAr: 'محلات المواد', senderLabelAr: 'الزبون',
      plusAr: 'تسديد دفعة', minusAr: 'تسجيل دين',
      plusContactAr: '💵 سدّد المقاول لكم دفعة', minusContactAr: '🧱 أخذ المقاول منكم مواد بالآجل',
      growsType: 'payment',
      balanceSentence: {
        heading: 'الحساب الآن',
        weOwe: (a) => `المقاول مدين لكم بـ ${a}`,
        theyOwe: (a) => `للمقاول عندكم ${a} (دفع أكثر من قيمة المواد)`,
        settled: 'الحساب مسدد ✔',
      },
    },
  ],
  defaultRole: 'worker',
  catalogRoles: ['materials'],
  noticeRoles: ['worker', 'client', 'broker', 'materials'],
};
