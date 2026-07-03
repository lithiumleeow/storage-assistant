import express from 'express';
import { findLocalMatches, rankPlacementCandidates } from './search.js';

function requireText(value, field) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    const err = new Error(`${field} is required`);
    err.status = 400;
    throw err;
  }
  return value.trim();
}

function tokenGuard(config) {
  return (req, res, next) => {
    if (req.get('X-Storage-Token') !== config.shortcutToken) {
      res.status(401).json({ error: 'Invalid or missing storage token' });
      return;
    }
    next();
  };
}

export function createRoutes({ config, db, ai }) {
  const router = express.Router();
  router.use(tokenGuard(config));

  router.post('/analyze', async (req, res, next) => {
    try {
      const text = requireText(req.body.text, 'text');
      const history = db.listItems({}).slice(0, 50);
      const similarItems = findLocalMatches(history, text, 8);
      const placementCandidates = rankPlacementCandidates(history, { rawText: text }, 5);
      const analysis = await ai.analyze({ text, similarItems, placementCandidates });
      const draft = db.createDraft({ rawText: text, analysis, recommendation: { placementCandidates } });
      res.json({ draftId: draft.id, ...analysis });
    } catch (err) {
      next(err);
    }
  });

  router.post('/confirm', (req, res, next) => {
    try {
      const draftId = requireText(req.body.draftId, 'draftId');
      const draft = db.getDraft(draftId);
      if (!draft || draft.status !== 'draft') {
        res.status(404).json({ error: 'Draft not found' });
        return;
      }
      const overrideItems = Array.isArray(req.body.items) ? req.body.items : [];
      const items = (draft.analysis.items || []).map((item, index) => ({ ...item, ...(overrideItems[index] || {}) }));
      const saved = items.map((item) => db.createItem({
        displayName: item.displayName,
        rawText: draft.rawText,
        description: item.description,
        category: item.category,
        tags: item.tags,
        useContext: item.useContext,
        relatedItems: item.relatedItems,
        location: item.location,
        zone: item.zone,
        placementReason: item.placementReason,
        confidence: item.confidence,
        photoPaths: item.photoPaths || []
      }));
      db.markDraftConfirmed(draftId);
      res.json({ ok: true, savedCount: saved.length, items: saved });
    } catch (err) {
      next(err);
    }
  });

  router.post('/search', async (req, res, next) => {
    try {
      const query = requireText(req.body.query, 'query');
      const matches = findLocalMatches(db.listItems({}), query, 10);
      if (matches.length === 0) {
        res.json({ answer: '没有找到匹配的记录，可以试试更宽泛的说法。', matches: [] });
        return;
      }
      const summary = await ai.summarizeSearch({ query, matches });
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  router.post('/recommend-location', async (req, res, next) => {
    try {
      const text = requireText(req.body.text, 'text');
      const candidates = rankPlacementCandidates(db.listItems({}), { rawText: text }, 5);
      const recommendation = await ai.recommendLocation({ text, candidates });
      res.json(recommendation);
    } catch (err) {
      next(err);
    }
  });

  router.get('/items', (req, res) => {
    res.json({ items: db.listItems({ query: req.query.q || '' }) });
  });

  router.get('/items/:id', (req, res) => {
    const item = db.getItem(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.json(item);
  });

  router.patch('/items/:id', (req, res) => {
    const item = db.updateItem(req.params.id, req.body);
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.json(item);
  });

  router.delete('/items/:id', (req, res) => {
    const item = db.softDeleteItem(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.json({ ok: true });
  });

  router.get('/export.csv', (req, res) => {
    const rows = db.listItems({});
    const header = ['id', 'displayName', 'category', 'tags', 'location', 'rawText', 'createdAt'];
    const csv = [
      header.join(','),
      ...rows.map((item) => header.map((key) => JSON.stringify(Array.isArray(item[key]) ? item[key].join('|') : item[key] || '')).join(','))
    ].join('\n');
    res.type('text/csv').send(csv);
  });

  return router;
}
