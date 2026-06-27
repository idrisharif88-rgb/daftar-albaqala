import 'dotenv/config';
import app from './app';

// Entry point for the running server: import the configured app and bind a port.
// (The app itself lives in app.ts with no listen(), so tests can drive it directly.)
const PORT = process.env.PORT ? Number(process.env.PORT) : 3002;

app.listen(PORT, () => {
  console.log(`daftar-api listening on port ${PORT}`);
});
