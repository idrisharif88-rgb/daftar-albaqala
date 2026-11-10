import { Router } from 'express';
import { redeemTicket, subscribe } from '../live/hub';

// GET /events?ticket=… — the live stream (see live/hub.ts). The ticket was
// issued to an authenticated caller a moment ago; it is the only auth here.
const router = Router();

router.get('/', (req, res) => {
  const channel = redeemTicket(String(req.query.ticket ?? ''));
  if (!channel) {
    res.set('Access-Control-Allow-Origin', '*');
    return res.status(401).json({ error: 'invalid or expired ticket' });
  }
  subscribe(channel, res);
});

export default router;
