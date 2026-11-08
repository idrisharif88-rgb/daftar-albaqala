// A tiny hook so the data layer can say "something changed" without importing
// the sync module (which would be a cycle, and would drag the network into the
// unit tests). The app registers the real thing while the POS section is on
// for the signed-in account; until then — and in tests — it does nothing.
let kick: (() => void) | null = null;

export function setPosKick(fn: (() => void) | null): void {
  kick = fn;
}

export function kickPosSync(): void {
  kick?.();
}
