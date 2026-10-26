import type { Flavor } from './types';

export const grocery: Flavor = {
  id: 'grocery',
  appName: 'دفتر البقالة',
  tagline: 'ديونك ودفعاتك، في دفتر واحد',
  loginTag: 'سجّل ديون ودفعات عملائك بسهولة',
  pitch: 'سجّل الديون والمدفوعات، واطبع الفواتير — يعمل بدون إنترنت.',
  accents: ['green', 'gold', 'orange'],
  brandColor: '#1B5E20',
  roles: [
    {
      // Someone who buys from the owner — the original case.
      role: 'customer', labelAr: 'زبون', pluralAr: 'زبائن', senderLabelAr: 'المتجر',
      plusAr: 'تسجيل دين', minusAr: 'تسديد دفعة',
      plusContactAr: 'تسجيل دين', minusContactAr: 'تسديد دفعة',
      growsType: 'debt',
    },
    {
      // A shop the owner buys FROM. Same two words as a customer — a debt is a
      // debt — but the sign is mirrored: goods taken on credit lower the
      // balance, so «تسجيل دين» is the minus direction here.
      role: 'supplier', labelAr: 'صاحب متجر', pluralAr: 'أصحاب المتاجر', senderLabelAr: 'الزبون',
      plusAr: 'تسديد دفعة', minusAr: 'تسجيل دين',
      plusContactAr: 'تسديد دفعة', minusContactAr: 'تسجيل دين',
      growsType: 'payment',
    },
    {
      // Peer trade — money moves both ways, so the wording is plainly personal.
      role: 'partner', labelAr: 'شريك', pluralAr: 'شركاء', senderLabelAr: 'الشريك',
      plusAr: 'دفعت له', minusAr: 'أخذت منه',
      plusContactAr: 'دفعت لك', minusContactAr: 'أخذت منك',
      growsType: 'payment',
    },
  ],
  defaultRole: 'customer',
  catalogRoles: ['supplier'],
  // A زبون is left out until that side of the book is in use — see
  // `usesMovementNotice` in roles.ts.
  noticeRoles: ['supplier', 'partner'],
};
