import express from 'express';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { callJsonModel } from './aiClient.js';
import { buildAnalyzeMessages, buildRecommendationMessages, buildSearchSummaryMessages } from './aiPrompts.js';
import { createRoutes } from './routes.js';

function createDefaultAi(config) {
  return {
    analyze({ text, similarItems, placementCandidates }) {
      return callJsonModel({ config, messages: buildAnalyzeMessages({ text, similarItems, placementCandidates }) });
    },
    summarizeSearch({ query, matches }) {
      return callJsonModel({ config, messages: buildSearchSummaryMessages({ query, matches }) });
    },
    recommendLocation({ text, candidates }) {
      return callJsonModel({ config, messages: buildRecommendationMessages({ text, candidates }) });
    }
  };
}

export function createApp(options = {}) {
  const config = { ...loadConfig(), ...(options.config || {}) };
  const db = options.db || createDatabase({ dataDir: config.dataDir });
  const ai = options.ai || createDefaultAi(config);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static('public'));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/version', (req, res) => {
    res.json({ version: config.version });
  });

  app.use('/api', createRoutes({ config, db, ai }));

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  createApp({ config }).listen(config.port, () => {
    console.log(`Storage assistant listening on ${config.port}`);
  });
}
