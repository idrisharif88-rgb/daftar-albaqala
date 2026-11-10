import { describe, expect, it } from 'vitest';
import { posTabsFor, firstPosTab } from './PosFooter';
import { ROLE_PRESETS, type Permission } from './permissions';

// Which POS tabs a person gets. The router uses the same list, so a tab that
// is not here cannot be opened by its address either.
const holding = (list: readonly Permission[]) => (p: Permission) => list.includes(p);
const paths = (list: readonly Permission[], isStaff = true, feature = true) =>
  posTabsFor(holding(list), isStaff, feature).map((t) => t.path);

describe('POS tabs by permission', () => {
  it('owner: every tab, plus «الموظفون» only when the developer switched it on', () => {
    expect(paths([], false, false)).toEqual([]); // `can` decides — the owner's `can` is always true:
    const all = (_: Permission) => true;
    expect(posTabsFor(all, false, false).map((t) => t.path))
      .toEqual(['/pos/today', '/pos/sell', '/pos/history', '/pos/products']);
    expect(posTabsFor(all, false, true).map((t) => t.path)).toContain('/pos/staff');
  });

  it('cashier preset: selling only', () => {
    expect(paths(ROLE_PRESETS.cashier)).toEqual(['/pos/sell']);
  });

  it('adder preset: the day and the history, no selling, no products', () => {
    expect(paths(ROLE_PRESETS.adder)).toEqual(['/pos/today', '/pos/history']);
  });

  it('admin preset: everything, including staff', () => {
    expect(paths(ROLE_PRESETS.admin)).toEqual(['/pos/today', '/pos/sell', '/pos/history', '/pos/products', '/pos/staff']);
  });

  it('no permissions at all: no tab, so the account page is the landing', () => {
    expect(firstPosTab(posTabsFor(holding([]), true, true))).toBeNull();
  });
});
