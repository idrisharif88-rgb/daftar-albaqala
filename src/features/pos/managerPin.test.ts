import { describe, expect, it } from 'vitest';
import { notePinAttempt, pinLockedMinutes, pinMatches, sha256Hex } from './managerPin';

describe('manager pin', () => {
  it('matches the salted hash the server sends, and nothing else', async () => {
    const stored = `s1:abcd:${await sha256Hex('abcd' + '583920')}`;
    expect(await pinMatches('583920', stored)).toBe(true);
    expect(await pinMatches('583921', stored)).toBe(false);
    expect(await pinMatches('583920', null)).toBe(false);
    expect(await pinMatches('58a920', stored)).toBe(false);
    expect(await pinMatches('583920', 'garbage')).toBe(false);
  });
});

describe('pin lock on this phone', () => {
  it('3 wrong codes lock «تراجع» for 5 minutes; a right one clears the count', () => {
    localStorage.clear();
    const t = 1_000_000;
    expect(notePinAttempt(false, t)).toBe(false);
    expect(notePinAttempt(true, t)).toBe(false); // right code resets
    expect(notePinAttempt(false, t)).toBe(false);
    expect(notePinAttempt(false, t)).toBe(false);
    expect(notePinAttempt(false, t)).toBe(true); // third wrong → locked
    expect(pinLockedMinutes(t)).toBe(5);
    expect(pinLockedMinutes(t + 5 * 60 * 1000)).toBe(0);
  });
});
