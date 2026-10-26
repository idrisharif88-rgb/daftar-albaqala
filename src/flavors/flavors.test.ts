import { ALL_FLAVORS } from '.';

// The two books stay apart only because no role code is shared — a code in
// both builds would put one app's contacts on the other's screens.
describe('flavors', () => {
  it('give every build its own role codes', () => {
    const codes = ALL_FLAVORS.flatMap((f) => f.roles.map((r) => r.role));
    expect(new Set(codes).size).toBe(codes.length);
  });

  // Drive's hidden folder is per Google project, which both apps share.
  it('back up to different Drive files', () => {
    const names = ALL_FLAVORS.map((f) => f.driveBackupFile);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keep their store and owner names apart', () => {
    const keys = ALL_FLAVORS.flatMap((f) => [f.nameKeys.store, f.nameKeys.owner]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only reference roles they define', () => {
    for (const f of ALL_FLAVORS) {
      const own = new Set(f.roles.map((r) => r.role));
      for (const r of [f.defaultRole, ...f.catalogRoles, ...f.noticeRoles]) {
        expect(own.has(r)).toBe(true);
      }
    }
  });
});
