import 'dotenv/config';
import express from 'express';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3002;

// Parse JSON request bodies (used by later routes).
app.use(express.json());

// Health check — confirms the server is alive and reachable.
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'daftar-api',
    time: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`daftar-api listening on port ${PORT}`);
});
