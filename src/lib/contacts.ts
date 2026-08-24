import { Capacitor, registerPlugin } from '@capacitor/core';

// Pick a customer's name + number from the phone's saved contacts.
//
// NO CONTACTS PERMISSION IS INVOLVED, deliberately. The app used to hold
// READ_CONTACTS — plus WRITE_CONTACTS, which it never used and only declared
// because @capacitor-community/contacts bundles both under one permission alias
// and refuses to open unless both are present. READ_CONTACTS means "let me read
// the entire address book at will", and Google Play prices it accordingly: a
// prominent in-app disclosure, a privacy-policy section and a Data Safety
// declaration, all to fill in two fields on a form.
//
// So the plugin is gone and Android's own picker is used instead
// (`ContactPickerPlugin.java`): the user chooses one contact, Android hands back
// that one row, and the address book is never exposed. No dialog is ever shown.
//
// Android only. On web there is no picker, so this returns null and the caller
// keeps whatever was typed by hand.

export interface PickedContact {
  name: string;
  phone: string;
}

interface ContactPickerPlugin {
  pick(): Promise<{ name?: string; phone?: string; cancelled?: boolean }>;
}

const ContactPicker = registerPlugin<ContactPickerPlugin>('ContactPicker');

export async function pickContact(): Promise<PickedContact | null> {
  if (Capacitor.getPlatform() !== 'android') return null;
  try {
    const result = await ContactPicker.pick();
    if (result.cancelled) return null;
    return {
      name: (result.name ?? '').trim(),
      // Strip spaces and dashes so it matches the format the app stores and
      // checks for uniqueness against.
      phone: (result.phone ?? '').replace(/[\s-]+/g, ''),
    };
  } catch (err) {
    // No contacts app, or the row could not be read. The manual fields still
    // work, so this must not become an error the owner has to dismiss.
    console.warn('contact picker unavailable', err);
    return null;
  }
}
