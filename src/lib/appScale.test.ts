import { describe, it, expect } from 'vitest';
import { maxScaleFor, scaleSteps } from './appScale';

// The ceilings measured on the owner's devices (see appScale.ts).
describe('maxScaleFor', () => {
  it('allows zoom by the device width', () => {
    expect(maxScaleFor(360)).toBe(100);
    expect(maxScaleFor(411)).toBe(110); // Note 9
    expect(maxScaleFor(412)).toBe(110);
    expect(maxScaleFor(600)).toBe(130);
    expect(maxScaleFor(800)).toBe(155); // Tab S6 and Tab Active 3
    expect(maxScaleFor(1200)).toBe(155);
  });

  it('never drops below 100 on small screens', () => {
    expect(maxScaleFor(320)).toBe(100);
  });
});

describe('scaleSteps', () => {
  it('ends at the device ceiling', () => {
    expect(scaleSteps(412).at(-1)).toBe(110);
    expect(scaleSteps(800).at(-1)).toBe(155);
    expect(scaleSteps(412)[0]).toBe(80);
  });
});
