// Telling "nothing on this phone can open that file" apart from "the owner
// changed their mind" — and both apart from a real failure.
//
// The system share sheet reports all three the same way: a rejected promise.
// The screens used to show «تعذّر إنشاء ملف PDF» for every one of them, which
// is wrong twice over — the file was created, and backing out of the sheet is
// not an error at all. On a bare emulator, where nothing handles a PDF, the
// owner (or a Play reviewer) is told the export is broken when it is not.
//
// This module is deliberately tiny and eagerly importable: the exporters are
// lazy-loaded chunks, so the screens need to recognise the error without
// pulling jspdf in behind it.

/** Nothing on this device can receive the file. */
export class NoShareTargetError extends Error {
  constructor() {
    super('no share target');
    this.name = 'NoShareTargetError';
  }
}

/** The owner dismissed the share sheet. Not a failure — say nothing. */
export class ShareCancelledError extends Error {
  constructor() {
    super('share cancelled');
    this.name = 'ShareCancelledError';
  }
}

/**
 * Map whatever the share plugin threw onto one of the two above.
 *
 * Capacitor's Share plugin rejects with a message containing "cancel" when the
 * sheet is dismissed; there is no error CODE to match on, so the text is all
 * there is to go by.
 */
export function classifyShareError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (/cancel/i.test(message)) return new ShareCancelledError();
  return new NoShareTargetError();
}
