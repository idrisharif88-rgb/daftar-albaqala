// The bundled examples. Each one is a folder in ../plugins-available — the SAME
// files the command-line host uses. / De medfølgende eksemplene. Hver er en mappe
// i ../plugins-available — de SAMME filene kommandolinje-verten bruker.
import barcodeSrc from '../../../plugins-available/barcode-ean13/index.mjs?raw';
import barcodeManifest from '../../../plugins-available/barcode-ean13/plugin.json?raw';
import deskSrc from '../../../plugins-available/barcode-desk/index.mjs?raw';
import deskManifest from '../../../plugins-available/barcode-desk/plugin.json?raw';
import invoiceSrc from '../../../plugins-available/invoice-desk/index.mjs?raw';
import invoiceManifest from '../../../plugins-available/invoice-desk/plugin.json?raw';
import ledgerSrc from '../../../plugins-available/debt-ledger/index.mjs?raw';
import ledgerManifest from '../../../plugins-available/debt-ledger/plugin.json?raw';
import { makeBundle, type Bundle } from './pluginHost';

/** `titleKey` is a translation key when the title should be translated; otherwise `title` is a name. */
export interface Example { id: string; icon: string; title: string; titleKey?: string; build: () => Promise<Bundle> }

export const examples: Example[] = [
  { id: 'barcode-desk', icon: '🏷️', title: 'Barcode Desk',
    build: () => makeBundle({ 'plugin.json': deskManifest, 'index.mjs': deskSrc }) },
  { id: 'invoice-desk', icon: '🧾', title: 'Invoice Desk',
    build: () => makeBundle({ 'plugin.json': invoiceManifest, 'index.mjs': invoiceSrc }) },
  { id: 'debt-ledger', icon: '📒', title: 'Debt Ledger',
    build: () => makeBundle({ 'plugin.json': ledgerManifest, 'index.mjs': ledgerSrc }) },
  { id: 'barcode-ean13', icon: '🔢', title: 'Barcode EAN-13', titleKey: 'ex.barcode-ean13.title',
    build: () => makeBundle({ 'plugin.json': barcodeManifest, 'index.mjs': barcodeSrc }) },
];
