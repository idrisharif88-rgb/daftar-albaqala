import { describe, expect, it } from 'vitest';
import { pinMatches, sha256Hex } from './managerPin';

describe('manager pin', () => {
  it('matches the salted hash the server sends, and nothing else', async () => {
    const stored = `s1:abcd:${await sha256Hex('abcd' + '4321')}`;
    expect(await pinMatches('4321', stored)).toBe(true);
    expect(await pinMatches('1234', stored)).toBe(false);
    expect(await pinMatches('4321', null)).toBe(false);
    expect(await pinMatches('43a1', stored)).toBe(false);
    expect(await pinMatches('4321', 'garbage')).toBe(false);
  });
});
