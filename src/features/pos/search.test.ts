import { describe, expect, it } from 'vitest';
import { matchesQuery } from './search';

const p = { name: 'خبز تنور بر', code: '2123456789010' };

describe('matchesQuery', () => {
  it('matches part of the name, or of the code', () => {
    expect(matchesQuery(p, 'تنور')).toBe(true);
    expect(matchesQuery(p, '3456')).toBe(true);
    expect(matchesQuery(p, 'كدم')).toBe(false);
  });
  it('an empty or blank query matches everything', () => {
    expect(matchesQuery(p, '')).toBe(true);
    expect(matchesQuery(p, '   ')).toBe(true);
  });
  it('accepts Arabic-Indic digits and stray spaces', () => {
    expect(matchesQuery(p, ' ٣٤٥٦ ')).toBe(true);
  });
  it('ignores case in Latin names', () => {
    expect(matchesQuery({ name: 'Honey Sidr', code: '2000000000008' }, 'sidr')).toBe(true);
  });
});
