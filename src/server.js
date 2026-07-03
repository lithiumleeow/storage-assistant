import express from 'express';
import { loadConfig } from './config.js';

export function createApp(options = {}) {
  const config = options.config || loadConfig();
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/version', (req, res) => {
    res.json({ version: config.version });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  createApp({ config }).listen(config.port, () => {
    console.log(`Storage assistant listening on ${config.port}`);
  });
}
