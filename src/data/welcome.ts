import { getManyMeta, setManyMeta } from './meta';

// The welcome at the top of Home: a badge with the owner's initial and name,
// a greeting for the time of day, and an optional line of their own. Synced
// with the account (settingsSync.ts), so a second phone greets the same way.

export interface Welcome {
  /** Off = no welcome at all (default on). */
  show: boolean;
  /** The owner's own second line; '' = the default one. */
  text: string;
}

export const WELCOME_TEXT_MAX = 80;
const KEYS = { show: 'ui_welcome_show', text: 'ui_welcome_text' } as const;

export async function getWelcome(): Promise<Welcome> {
  const m = await getManyMeta([KEYS.show, KEYS.text]);
  return { show: m[KEYS.show] !== '0', text: (m[KEYS.text] ?? '').trim() };
}

export async function saveWelcome(w: Welcome): Promise<void> {
  await setManyMeta({
    [KEYS.show]: w.show ? '1' : '0',
    [KEYS.text]: w.text.trim().slice(0, WELCOME_TEXT_MAX),
  });
}

/** «صباح الخير» before noon, «مساء الخير» after — on the phone's own clock. */
export function greeting(now = new Date()): string {
  return now.getHours() < 12 ? 'صباح الخير' : 'مساء الخير';
}

/** The first letter shown in the badge; «؟» when there is no name yet. */
export function initialOf(name: string): string {
  const t = name.trim();
  return t ? Array.from(t)[0] : '؟';
}
