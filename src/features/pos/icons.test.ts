import { describe, expect, it } from 'vitest';
import { ICONS, ICON_LABELS } from './icons';

// An icon-only control must still have a name (screen readers, hover text).
// This keeps the two tables in step: adding an icon without its label fails here.
describe('icon registry', () => {
  it('every icon has a label, and every label an icon', () => {
    expect(Object.keys(ICON_LABELS).sort()).toEqual(Object.keys(ICONS).sort());
  });
  it('labels are not empty', () => {
    for (const label of Object.values(ICON_LABELS)) expect(label.trim().length).toBeGreaterThan(0);
  });
});
