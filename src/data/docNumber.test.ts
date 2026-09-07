import { describe, it, expect } from 'vitest';
import { noticeNote } from './docNumber';

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
