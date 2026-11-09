// The app's language: English, Arabic or Norwegian — ONE at a time, never mixed.
// Appens språk: engelsk, arabisk eller norsk — ÉTT om gangen, aldri blandet.
import { IonButtons, IonSelect, IonSelectOption } from '@ionic/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PluginError } from './pluginHost';

export type Lang = 'en' | 'ar' | 'no';
type Dict = Record<string, string>;

const en: Dict = {
  'tab.apps': 'Apps', 'tab.plugins': 'Plugins', 'tab.add': 'Add',
  'apps.title': 'Apps', 'apps.empty': 'No plugin screens yet.', 'apps.add': 'Add a plugin',
  'plugins.title': 'Plugins', 'plugins.empty': 'No plugins yet.', 'plugins.addOne': 'Add one',
  'plugins.removeQ': 'Remove {id}?', 'plugins.removeMsg': 'Its commands stop working. You can add it again.',
  'plugins.cancel': 'Cancel', 'plugins.remove': 'Remove', 'plugins.failed': 'would not start',
  'plugins.export': 'Export {id}', 'plugins.removeAria': 'Remove {id}',
  'add.title': 'Add a plugin', 'add.install': 'Install', 'add.fileTitle': 'From a file',
  'add.fileText': 'Pick a .plugin.json exported from another phone or the laptop host.', 'add.choose': 'Choose file',
  'add.installed': '{name} installed', 'add.imported': '{name} imported',
  'ex.barcode-desk.blurb': 'A whole barcode workspace: products, prices, labels, scanning, counting, sounds.',
  'ex.invoice-desk.blurb': 'A price list and an invoice maker: pick items, review the total, record, print or share as PDF.',
  'ex.debt-ledger.blurb': 'Contacts, debts and payments with a running balance per currency. Corrections are opposite entries. PDF statements.',
  'ex.barcode-ean13.title': 'Barcode EAN-13 (commands)', 'ex.barcode-ean13.blurb': 'Commands only (no screen): generate, validate and draw barcodes from code.',
  'err.notJson': 'The file is not valid JSON.', 'err.notBundle': 'This is not a plugin file.',
  'err.checksum': 'The file was changed after it was exported — refused.',
  'lang.label': 'Language',
};
const ar: Dict = {
  'tab.apps': 'التطبيقات', 'tab.plugins': 'الإضافات', 'tab.add': 'إضافة',
  'apps.title': 'التطبيقات', 'apps.empty': 'لا توجد شاشات إضافات بعد.', 'apps.add': 'أضف إضافة',
  'plugins.title': 'الإضافات', 'plugins.empty': 'لا توجد إضافات بعد.', 'plugins.addOne': 'أضف واحدة',
  'plugins.removeQ': 'إزالة {id}؟', 'plugins.removeMsg': 'ستتوقف أوامرها عن العمل. يمكنك إضافتها مجدداً.',
  'plugins.cancel': 'إلغاء', 'plugins.remove': 'إزالة', 'plugins.failed': 'لم تعمل',
  'plugins.export': 'تصدير {id}', 'plugins.removeAria': 'إزالة {id}',
  'add.title': 'إضافة جديدة', 'add.install': 'تثبيت', 'add.fileTitle': 'من ملف',
  'add.fileText': 'اختر ملف .plugin.json مُصدَّراً من هاتف آخر أو من الحاسوب.', 'add.choose': 'اختر ملفاً',
  'add.installed': 'تم تثبيت {name}', 'add.imported': 'تم استيراد {name}',
  'ex.barcode-desk.blurb': 'مساحة عمل كاملة للباركود: منتجات وأسعار وملصقات ومسح وعدّ وأصوات.',
  'ex.invoice-desk.blurb': 'قائمة أسعار وصانع فواتير: اختر الأصناف، راجع الإجمالي، سجّل، اطبع أو شارك PDF.',
  'ex.debt-ledger.blurb': 'جهات وديون ودفعات مع رصيد جارٍ لكل عملة. التصحيح بقيد معاكس. كشوف حساب PDF.',
  'ex.barcode-ean13.title': 'باركود EAN-13 (أوامر)', 'ex.barcode-ean13.blurb': 'أوامر فقط (بدون شاشة): توليد الباركود والتحقق منه ورسمه من الكود.',
  'err.notJson': 'الملف ليس بصيغة JSON صحيحة.', 'err.notBundle': 'هذا ليس ملف إضافة.',
  'err.checksum': 'تم تعديل الملف بعد تصديره — تم الرفض.',
  'lang.label': 'اللغة',
};
const no: Dict = {
  'tab.apps': 'Apper', 'tab.plugins': 'Plugins', 'tab.add': 'Legg til',
  'apps.title': 'Apper', 'apps.empty': 'Ingen pluginskjermer ennå.', 'apps.add': 'Legg til en plugin',
  'plugins.title': 'Plugins', 'plugins.empty': 'Ingen plugins ennå.', 'plugins.addOne': 'Legg til en',
  'plugins.removeQ': 'Fjerne {id}?', 'plugins.removeMsg': 'Kommandoene slutter å virke. Du kan legge den til igjen.',
  'plugins.cancel': 'Avbryt', 'plugins.remove': 'Fjern', 'plugins.failed': 'startet ikke',
  'plugins.export': 'Eksporter {id}', 'plugins.removeAria': 'Fjern {id}',
  'add.title': 'Legg til en plugin', 'add.install': 'Installer', 'add.fileTitle': 'Fra en fil',
  'add.fileText': 'Velg en .plugin.json eksportert fra en annen telefon eller laptop-verten.', 'add.choose': 'Velg fil',
  'add.installed': '{name} installert', 'add.imported': '{name} importert',
  'ex.barcode-desk.blurb': 'Et helt strekkodearbeidsrom: varer, priser, etiketter, skanning, telling, lyder.',
  'ex.invoice-desk.blurb': 'En prisliste og fakturalager: velg varer, gjennomgå summen, registrer, skriv ut eller del som PDF.',
  'ex.debt-ledger.blurb': 'Kontakter, gjeld og betalinger med løpende saldo per valuta. Rettelser er motposter. PDF-kontoutskrifter.',
  'ex.barcode-ean13.title': 'EAN-13-strekkode (kommandoer)', 'ex.barcode-ean13.blurb': 'Bare kommandoer (ingen skjerm): lag, valider og tegn strekkoder fra kode.',
  'err.notJson': 'Filen er ikke gyldig JSON.', 'err.notBundle': 'Dette er ikke en pluginfil.',
  'err.checksum': 'Filen ble endret etter eksport — avvist.',
  'lang.label': 'Språk',
};
const DICT: Record<Lang, Dict> = { en, ar, no };
const KEY = 'plugin-lab.lang';

interface Ctx { lang: Lang; setLang(l: Lang): void; t(key: string, vars?: Record<string, string>): string; error(e: unknown): string }
const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try { const v = localStorage.getItem(KEY); return v === 'ar' || v === 'no' ? v : 'en'; } catch { return 'en'; }
  });
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try { localStorage.setItem(KEY, lang); } catch { /* a convenience only */ }
  }, [lang]);
  const t = useCallback((key: string, vars?: Record<string, string>) => {
    let text = DICT[lang][key] ?? en[key] ?? key;
    for (const [k, v] of Object.entries(vars ?? {})) text = text.replaceAll(`{${k}}`, v);
    return text;
  }, [lang]);
  // An error shown to the person: translated when we know it, plain English otherwise.
  const error = useCallback((e: unknown) =>
    e instanceof PluginError ? t(`err.${e.code}`) : e instanceof Error ? e.message : String(e), [t]);
  const value = useMemo(() => ({ lang, setLang: setLangState, t, error }), [lang, t, error]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}
export const useT = () => {
  const c = useContext(LangCtx);
  if (!c) throw new Error('useT outside LangProvider');
  return c;
};

/** The language drop-down for a toolbar: all three languages, current one selected. */
export function LangPicker() {
  const { lang, setLang, t } = useT();
  return (
    <IonButtons slot="end">
      <IonSelect className="lang-pick" value={lang} interface="popover" aria-label={t('lang.label')}
        selectedText={lang.toUpperCase()} onIonChange={e => setLang(e.detail.value as Lang)}>
        <IonSelectOption value="en">English</IonSelectOption>
        <IonSelectOption value="ar">العربية</IonSelectOption>
        <IonSelectOption value="no">Norsk</IonSelectOption>
      </IonSelect>
    </IonButtons>
  );
}
