import { describe, it, expect } from 'vitest';
import { noticeNote, parseDocNote } from './docNumber';

// The number has to be in the LEDGER, not only in the message: it is what the
// counter reads back after a reinstall (which wipes app_meta but not the
// entries, since those sync back).
describe('noticeNote', () => {
  it('leads the entry note with the number', () => {
    expect(noticeNote(5, 'كيس دقيق')).toBe('إشعار رقم 5: كيس دقيق');
  });

  it('stands alone when the owner wrote no note', () => {
    expect(noticeNote(5, '')).toBe('إشعار رقم 5');
    expect(noticeNote(5, '   ')).toBe('إشعار رقم 5');
  });
});

// A reprinted receipt reads the number back out of the note.
describe('parseDocNote', () => {
  it('reads an invoice number and strips it from the note', () => {
    expect(parseDocNote('فاتورة رقم 12: جبن ×3، سكر ×2'))
      .toEqual({ kind: 'invoice', number: 12, rest: 'جبن ×3، سكر ×2' });
  });

  it('reads a notice number, with or without a note after it', () => {
    expect(parseDocNote('إشعار رقم 5: كيس دقيق'))
      .toEqual({ kind: 'notice', number: 5, rest: 'كيس دقيق' });
    expect(parseDocNote('إشعار رقم 5'))
      .toEqual({ kind: 'notice', number: 5, rest: '' });
  });

  it('leaves an ordinary note alone', () => {
    expect(parseDocNote('دين قديم')).toEqual({ kind: null, number: null, rest: 'دين قديم' });
    expect(parseDocNote(null)).toEqual({ kind: null, number: null, rest: '' });
  });
});
