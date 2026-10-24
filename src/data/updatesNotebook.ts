// «دفتر التحديثات» — the owner's notes on what he wants added to the app,
// written while he uses it. Copied from «خماسيات». Shown to his account only
// (isOwner in lib/auth.tsx).
//
// Kept in localStorage on this device, deliberately NOT in `app_meta`: that is
// wiped on every account switch (data/owner.ts), and the owner switches to test
// accounts — his notes must outlive that.
//
// Pure functions; the page holds the state.

export interface Note {
  id: string;
  title: string;
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
}

export const NOTEBOOK_STORAGE_KEY = 'daftar-updates-notebook-v1';

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function normalizeNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((n) => n && typeof n.id === 'string')
    .map((n) => ({
      id: n.id,
      title: clean(n.title),
      text: typeof n.text === 'string' ? n.text : '',
      done: n.done === true,
      createdAt: Number(n.createdAt) || 0,
      updatedAt: Number(n.updatedAt) || Number(n.createdAt) || 0,
    }));
}

export const newNoteId = () =>
  `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** A note with neither title nor text is not kept — and emptying one deletes it. */
export function saveNote(
  notes: Note[], { id, title, text }: { id?: string; title?: string; text?: string },
  now = Date.now(),
): Note[] {
  const entry = { title: clean(title), text: (text || '').trim() };
  if (!entry.title && !entry.text) return id ? notes.filter((n) => n.id !== id) : notes;
  if (id && notes.some((n) => n.id === id)) {
    return notes.map((n) => (n.id === id ? { ...n, ...entry, updatedAt: now } : n));
  }
  return [...notes, { id: id || newNoteId(), ...entry, done: false, createdAt: now, updatedAt: now }];
}

export const toggleDone = (notes: Note[], id: string, now = Date.now()): Note[] =>
  notes.map((n) => (n.id === id ? { ...n, done: !n.done, updatedAt: now } : n));

export const removeNote = (notes: Note[], id: string): Note[] => notes.filter((n) => n.id !== id);

/** Open notes first (newest on top), then done ones (most recently finished on top). */
export function sortedNotes(notes: Note[]): { open: Note[]; done: Note[] } {
  const open = notes.filter((n) => !n.done).sort((a, b) => b.createdAt - a.createdAt);
  const done = notes.filter((n) => n.done).sort((a, b) => b.updatedAt - a.updatedAt);
  return { open, done };
}

export function loadNotes(): Note[] {
  try {
    return normalizeNotes(JSON.parse(localStorage.getItem(NOTEBOOK_STORAGE_KEY) ?? 'null'));
  } catch {
    return [];
  }
}

export function storeNotes(notes: Note[]): void {
  try {
    localStorage.setItem(NOTEBOOK_STORAGE_KEY, JSON.stringify(notes));
  } catch {
    // Storage full or blocked: the notes stay on screen for this session.
  }
}
