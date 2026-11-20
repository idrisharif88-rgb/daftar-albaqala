// Whether the fingerprint lock (BiometricGate) is covering the app right now.
// Anything that must be SEEN — the shop's intro after sign-in — waits for it,
// or it plays hidden behind the lock and only its last moment shows.

export const GATE_EVENT = 'daftar:gate';
let locked = false;
let unlockedAt = 0;

export function setGateLocked(value: boolean): void {
  if (locked === value) return;
  locked = value;
  if (!value) unlockedAt = Date.now();
  window.dispatchEvent(new Event(GATE_EVENT));
}

export function isGateLocked(): boolean {
  return locked;
}

/** When the lock last lifted (0 = never this session). */
export function gateUnlockedAt(): number {
  return unlockedAt;
}
