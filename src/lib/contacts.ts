import { Capacitor } from '@capacitor/core';
import { Contacts } from '@capacitor-community/contacts';

// Pick a customer's name + number from the phone's saved contacts. Uses the
// native contact picker (Android only); on web there's no picker, so it returns
// null and the caller just keeps the manual fields.

export interface PickedContact {
  name: string;
  phone: string;
}

export async function pickContact(): Promise<PickedContact | null> {
  if (Capacitor.getPlatform() !== 'android') return null;

  // The picker needs read access to contacts.
  const perm = await Contacts.requestPermissions();
  if (perm.contacts !== 'granted') return null;

  const { contact } = await Contacts.pickContact({
    projection: { name: true, phones: true },
  });
  if (!contact) return null;

  const name = contact.name?.display ?? '';
  // Take the first listed number; strip spaces so it matches our phone format.
  const phone = (contact.phones?.[0]?.number ?? '').replace(/\s+/g, '');
  return { name, phone };
}
