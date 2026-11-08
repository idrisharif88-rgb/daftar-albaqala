import { describe, expect, it } from 'vitest';
import { beepBad, beepOk, setSoundEnabled, soundEnabled, unlockAudio } from './beep';

// jsdom has no Web Audio — which is the point: the beeps must be harmless
// wherever audio is missing (a browser tab, a test, an odd WebView).
describe('beep', () => {
  it('never throws without audio support', () => {
    expect(() => { unlockAudio(); beepOk(); beepBad(); }).not.toThrow();
  });
  it('can be switched off, and remembers it', () => {
    setSoundEnabled(false);
    expect(soundEnabled()).toBe(false);
    expect(() => beepOk()).not.toThrow();
    setSoundEnabled(true);
    expect(soundEnabled()).toBe(true);
  });
});
