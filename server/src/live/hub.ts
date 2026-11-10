import { randomBytes } from 'crypto';
import type { Response } from 'express';

// A live line from the server to an open app — server-sent events (SSE).
// Used so a request reaches the user AT ONCE (the Watcher's sync request →
// the shopkeeper's app; the shopkeeper's answer → the Watcher), instead of
// waiting for the next poll.
//
// One process, so subscribers live in memory. A restart drops every line; each
// app reconnects by itself and re-reads its state, so nothing is lost — an
// event is only ever a "look again" signal, never the data itself.
//
// 🧩 Server concept: an EventSource cannot send an Authorization header, and a
// token in a URL ends up in logs. So the app first trades its token for a
// one-time TICKET (an ordinary authenticated POST), then opens the stream
// with that ticket. A ticket is single-use and dies in 30 s.

const TICKET_TTL_MS = 30_000;
const HEARTBEAT_MS = 25_000; // under nginx's 60 s proxy_read_timeout

const channels = new Map<string, Set<Response>>();
const tickets = new Map<string, { channel: string; exp: number }>();

/** A one-time ticket for `channel` ('user:<id>' or 'admin'). */
export function issueTicket(channel: string, now = Date.now()): string {
  for (const [t, v] of tickets) if (v.exp < now) tickets.delete(t); // tidy as we go
  const ticket = randomBytes(24).toString('hex');
  tickets.set(ticket, { channel, exp: now + TICKET_TTL_MS });
  return ticket;
}

/** Spend a ticket: its channel, or null if unknown / used / expired. */
export function redeemTicket(ticket: string, now = Date.now()): string | null {
  const v = tickets.get(ticket);
  tickets.delete(ticket);
  return v && v.exp >= now ? v.channel : null;
}

/** Keep `res` open as an event stream on `channel` until the client leaves. */
export function subscribe(channel: string, res: Response): void {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell nginx not to hold the stream back
    // The phone's WebView opens this cross-origin; the ticket is the auth.
    'Access-Control-Allow-Origin': '*',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  let set = channels.get(channel);
  if (!set) { set = new Set(); channels.set(channel, set); }
  set.add(res);
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  res.on('close', () => {
    clearInterval(beat);
    const s = channels.get(channel);
    s?.delete(res);
    if (s && s.size === 0) channels.delete(channel);
  });
}

/** Tell everyone on `channel` that `event` happened. Never throws. */
export function publish(channel: string, event: string, data: Record<string, unknown> = {}): void {
  const set = channels.get(channel);
  if (!set) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(frame); } catch { /* the close handler will drop it */ }
  }
}

/** For tests. */
export function subscriberCount(channel: string): number {
  return channels.get(channel)?.size ?? 0;
}
