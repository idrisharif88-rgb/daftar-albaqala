import { API_BASE } from '../config';
import { liveTicket } from './api';

// The live line from the server (server/src/live/hub.ts): a one-time ticket,
// then an EventSource. The server only says "look again" — the handler
// re-reads the state through the normal API. On any break the line is closed
// and reopened a few seconds later with a FRESH ticket (EventSource's own
// retry would reuse the spent one).

export type LiveHandler = (event: string, data: Record<string, unknown>) => void;

const EVENTS = ['sync-request', 'access', 'chat'];
const RETRY_MS = 5000;

/** Open the line; returns a function that closes it for good. */
export function openLive(onEvent: LiveHandler, getTicket: () => Promise<string> = async () => (await liveTicket()).ticket): () => void {
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
    try { ticket = await getTicket(); } catch { retry(); return; }
    if (stopped) return;
    source = new EventSource(`${API_BASE}/events?ticket=${encodeURIComponent(ticket)}`);
    for (const name of EVENTS) {
      source.addEventListener(name, (e) => {
        let data: Record<string, unknown> = {};
        try { data = JSON.parse((e as MessageEvent).data) as Record<string, unknown>; } catch { /* keep {} */ }
        onEvent(name, data);
      });
    }
    source.onerror = retry;
  };

  void connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    source?.close();
  };
}
