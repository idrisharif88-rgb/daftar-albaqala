import { describe, it, expect } from 'vitest';
import { normalizeNotes, saveNote, toggleDone, removeNote, sortedNotes, type Note } from './updatesNotebook';

describe('owner updates notebook', () => {
  it('adds, edits, ticks and removes notes', () => {
    let notes = saveNote([], { title: ' زر جديد ', text: 'في الفاتورة' }, 10);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: 'زر جديد', text: 'في الفاتورة', done: false, createdAt: 10 });
    const { id } = notes[0];
    notes = saveNote(notes, { id, title: 'زر أكبر', text: '' }, 20);
    expect(notes[0]).toMatchObject({ title: 'زر أكبر', text: '', updatedAt: 20, createdAt: 10 });
    notes = toggleDone(notes, id, 30);
    expect(notes[0].done).toBe(true);
    expect(removeNote(notes, id)).toEqual([]);
  });

  it('does not keep an empty note, and emptying one deletes it', () => {
    expect(saveNote([], { title: '  ', text: '' })).toEqual([]);
    const notes = saveNote([], { title: 'x' }, 1);
    expect(saveNote(notes, { id: notes[0].id, title: '', text: ' ' })).toEqual([]);
  });

  it('lists open notes newest first, then done ones by when they were finished', () => {
    const notes = [
      { id: 'a', title: 'a', done: false, createdAt: 1, updatedAt: 1 },
      { id: 'b', title: 'b', done: true, createdAt: 2, updatedAt: 9 },
      { id: 'c', title: 'c', done: false, createdAt: 3, updatedAt: 3 },
      { id: 'd', title: 'd', done: true, createdAt: 4, updatedAt: 5 },
    ] as Note[];
    const { open, done } = sortedNotes(notes);
    expect(open.map((n) => n.id)).toEqual(['c', 'a']);
    expect(done.map((n) => n.id)).toEqual(['b', 'd']);
  });

  it('cleans stored data', () => {
    expect(normalizeNotes(null)).toEqual([]);
    expect(normalizeNotes([{ id: 'x', title: 5, done: 'yes' }, { title: 'no id' }])).toEqual([
      { id: 'x', title: '', text: '', done: false, createdAt: 0, updatedAt: 0 },
    ]);
  });
});
