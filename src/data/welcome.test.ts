import { describe, it, expect } from 'vitest';
import { greeting, initialOf } from './welcome';

describe('welcome', () => {
  it('greets by the time of day', () => {
    expect(greeting(new Date(2026, 10, 20, 8, 0))).toBe('صباح الخير');
    expect(greeting(new Date(2026, 10, 20, 19, 0))).toBe('مساء الخير');
  });
  it('badge shows the first letter, or ؟ without a name', () => {
    expect(initialOf('  إدريس')).toBe('إ');
    expect(initialOf('')).toBe('؟');
  });
});
