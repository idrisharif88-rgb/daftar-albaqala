import { describe, it, expect } from 'vitest';
import { summarizeBackup } from './backupSummary';

describe('summarizeBackup', () => {
  it('counts a full backup, leaving out deleted rows', () => {
    const s = summarizeBackup({
      app: 'daftar-albaqala', version: 1,
      tables: {
        customers: [{ id: 'a' }, { id: 'b' }, { id: 'c', deleted_at: '2026-10-01T00:00:00Z' }],
        transactions: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
        items: [{ id: 'i1' }, { id: 'i2', deleted_at: '2026-10-01' }],
        item_groups: [{ id: 'g1' }],
      },
      settings: [],
    });
    expect(s).toMatchObject({ contacts: 2, entries: 3, items: 1, groups: 1, isEmpty: false });
    expect(s.sentence).toBe('2 جهة، 3 حركة، 1 صنف، 1 مجموعة');
  });

  it('handles an older backup with tables missing', () => {
    const s = summarizeBackup({ tables: { customers: [{ id: 'a' }], transactions: [{ id: 't' }] } });
    expect(s).toMatchObject({ contacts: 1, entries: 1, items: 0, groups: 0, isEmpty: false });
    expect(s.sentence).toBe('1 جهة، 1 حركة');
  });

  it('calls a backup with only settings empty', () => {
    const s = summarizeBackup({
      tables: { customers: [], transactions: [], items: [], item_groups: [] },
      settings: [{ key: 'store_name', value: 'x', updated_at: '' }],
    });
    expect(s.isEmpty).toBe(true);
  });

  it('never throws on garbage', () => {
    for (const bad of [null, undefined, {}, [], 'x', 42, { tables: 'no' }, { tables: { customers: 'no' } },
      { tables: { customers: [null, 5, 'x'] } }]) {
      expect(() => summarizeBackup(bad)).not.toThrow();
      expect(summarizeBackup(bad).isEmpty).toBe(true);
    }
  });
});
