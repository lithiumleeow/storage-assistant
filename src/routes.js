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

function extractDraftId(body) {
  if (typeof body === 'string') {
    const text = body.trim();
    if (text.startsWith('{')) {
      try {
        return extractDraftId(JSON.parse(text));
      } catch {
        return text;
      }
    }
    return text;
  }
  if (!body || typeof body !== 'object') return '';
  return String(
    body.draftId ||
    body.draft_id ||
    body.text ||
    body.value ||
    body.result?.draftId ||
    ''
  ).trim();
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeItem(item, rawText) {
  return {
    displayName: item.displayName || item.display_name || item.name || 'Unnamed item',
    rawText: item.rawText || item.raw_text || rawText || '',
    description: item.description || '',
    category: item.category || 'uncategorized',
    tags: normalizeArray(item.tags || item.tags_json),
    useContext: item.useContext || item.use_context || '',
    relatedItems: normalizeArray(item.relatedItems || item.related_items || item.related_items_json),
    location: item.location || '',
    zone: item.zone || '',
    placementReason: item.placementReason || item.placement_reason || '',
    confidence: Number(item.confidence || 0),
    photoPaths: normalizeArray(item.photoPaths || item.photo_paths || item.photo_paths_json)
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
      const draftId = requireText(extractDraftId(req.body), 'draftId');
      const draft = db.getDraft(draftId);
      if (!draft || draft.status !== 'draft') {
        res.status(404).json({ error: 'Draft not found' });
        return;
      }
      const overrideItems = Array.isArray(req.body.items) ? req.body.items : [];
      const draftItems = Array.isArray(draft.analysis.items) ? draft.analysis.items : [];
      if (draftItems.length === 0) {
        res.status(422).json({ error: 'Draft has no item records to save' });
        return;
      }
      const items = draftItems.map((item, index) => normalizeItem({ ...item, ...(overrideItems[index] || {}) }, draft.rawText));
      const saved = items.map((item) => db.createItem(item));
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

  router.post('/items', (req, res, next) => {
    try {
      const displayName = requireText(req.body.displayName, 'displayName');
      const location = requireText(req.body.location, 'location');
      const item = db.createItem({
        displayName,
        rawText: req.body.rawText || `${displayName} ${location}`,
        description: req.body.description || '',
        category: req.body.category || 'manual',
        tags: Array.isArray(req.body.tags) ? req.body.tags : [],
        useContext: req.body.useContext || '',
        relatedItems: Array.isArray(req.body.relatedItems) ? req.body.relatedItems : [],
        location,
        zone: req.body.zone || '',
        placementReason: req.body.placementReason || 'Manual admin entry',
        confidence: Number(req.body.confidence || 1),
        photoPaths: Array.isArray(req.body.photoPaths) ? req.body.photoPaths : []
      });
      res.json(item);
    } catch (err) {
      next(err);
    }
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
