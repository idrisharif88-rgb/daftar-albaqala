import { useEffect, useState } from 'react';
import { chatUnread } from '../../lib/api';
import { CHAT_EVENT } from '../../lib/auth';

// The badge on the chat tab: how many messages from the other side are unread.
// Re-read AT ONCE when the live line says a message came (CHAT_EVENT), and
// every minute as a fallback while the app is on screen.

const EVERY_MS = 60_000;
let listeners = new Set<(n: number) => void>();
let last = 0;

/** Tell every badge the count changed (the thread page calls it after reading). */
export function setChatUnread(n: number): void {
  last = n;
  listeners.forEach((f) => f(n));
}

export async function refreshChatUnread(): Promise<void> {
  try { setChatUnread((await chatUnread()).unread); } catch { /* offline: keep the last count */ }
}

export function useChatUnread(enabled: boolean): number {
  const [n, setN] = useState(last);
  useEffect(() => {
    if (!enabled) return undefined;
    listeners.add(setN);
    void refreshChatUnread();
    const tick = () => { if (document.visibilityState === 'visible') void refreshChatUnread(); };
    const timer = setInterval(tick, EVERY_MS);
    document.addEventListener('visibilitychange', tick);
    const onChat = () => { void refreshChatUnread(); };
    window.addEventListener(CHAT_EVENT, onChat);
    return () => {
      listeners.delete(setN);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener(CHAT_EVENT, onChat);
    };
  }, [enabled]);
  return enabled ? n : 0;
}

/** For tests. */
export function resetChatUnread(): void { listeners = new Set(); last = 0; }
