import { liveTicket } from './api';

// The Watcher's live line (server/src/live/hub.ts, channel 'admin'): the
// moment a user answers a sync request, the server says so here. A one-time
// ticket, then an EventSource; on any break, reopen with a fresh ticket.

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const RETRY_MS = 5000;

export function openLive(onEvent: (event: string, data: Record<string, unknown>) => void): () => void {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const retry = () => {
    source?.close();
    source = null;
    if (!stopped && !timer) timer = setTimeout(() => { timer = null; void connect(); }, RETRY_MS);
  };
  const connect = async () => {
    if (stopped || typeof EventSource === 'undefined') return;
    let ticket: string;
    try { ticket = (await liveTicket()).ticket; } catch { retry(); return; }
    if (stopped) return;
    source = new EventSource(`${API_BASE}/events?ticket=${encodeURIComponent(ticket)}`);
    source.addEventListener('consent', (e) => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse((e as MessageEvent).data) as Record<string, unknown>; } catch { /* keep {} */ }
      onEvent('consent', data);
    });
    source.onerror = retry;
  };
  void connect();
  return () => { stopped = true; if (timer) clearTimeout(timer); source?.close(); };
}
