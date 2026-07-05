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

function parseBodyObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    if (typeof body === 'string' && body.trim().startsWith('{')) {
      try {
        return JSON.parse(body);
      } catch {
        return {};
      }
    }
    return {};
  }
  return body;
}

function parseBoolean(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function extractConfirmOptions(body, query = {}) {
  const bodyObject = parseBodyObject(body);
  return {
    draftId: requireText(query.draftId || query.draft_id || extractDraftId(body), 'draftId'),
    selectedLocationId: String(
      query.selectedLocationId ||
      query.selected_location_id ||
      bodyObject.selectedLocationId ||
      bodyObject.selected_location_id ||
      ''
    ).trim(),
    createSuggestedLocation: parseBoolean(
      query.createSuggestedLocation ||
      query.create_suggested_location ||
      bodyObject.createSuggestedLocation ||
      bodyObject.create_suggested_location
    )
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function optionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildStructuredLocationPath(body) {
  const hasStructuredFields = body.room !== undefined || body.area !== undefined || body.detail !== undefined;
  if (!hasStructuredFields) return '';
  const room = requireText(body.room, 'room');
  return [room, optionalText(body.area), optionalText(body.detail)].filter(Boolean).join(' / ');
}

function normalizeItem(item, rawText) {
  return {
    displayName: item.displayName || item.display_name || item.name || 'Unnamed item',
    rawText: item.rawText || item.raw_text || rawText || '',
    correctedText: item.correctedText || item.corrected_text || '',
    description: item.description || '',
    category: item.category || 'uncategorized',
    tags: normalizeArray(item.tags || item.tags_json),
    useContext: item.useContext || item.use_context || '',
    relatedItems: normalizeArray(item.relatedItems || item.related_items || item.related_items_json),
    location: item.location || '',
    locationId: item.locationId || item.location_id || null,
    locationMatchStatus: item.locationMatchStatus || item.location_match_status || '',
    locationCandidates: normalizeArray(item.locationCandidates || item.location_candidates || item.location_candidates_json),
    zone: item.zone || '',
    placementReason: item.placementReason || item.placement_reason || '',
    confidence: Number(item.confidence || 0),
    photoPaths: normalizeArray(item.photoPaths || item.photo_paths || item.photo_paths_json)
  };
}

function resolveDraftLocation({ db, draft, item, selectedLocationId, createSuggestedLocation }) {
  const analysis = draft.analysis || {};
  const preferredLocationId = selectedLocationId || item.locationId || analysis.locationId || '';
  if (preferredLocationId) {
    const location = db.getLocation(preferredLocationId);
    if (!location || location.status === 'archived') {
      const err = new Error('Selected location not found');
      err.status = 404;
      throw err;
    }
    return { locationId: location.id, location: location.path };
  }

  if (createSuggestedLocation && analysis.suggestedLocationPath) {
    const location = db.createLocationPath(analysis.suggestedLocationPath);
    return { locationId: location.id, location: location.path };
  }

  return { locationId: item.locationId || null, location: item.location || analysis.location || '' };
}

function confirmDraft({ db, body, query }) {
  const { draftId, selectedLocationId, createSuggestedLocation } = extractConfirmOptions(body, query);
  const draft = db.getDraft(draftId);
  if (!draft || draft.status !== 'draft') {
    const err = new Error('Draft not found');
    err.status = 404;
    throw err;
  }
  const bodyObject = parseBodyObject(body);
  const overrideItems = Array.isArray(bodyObject.items) ? bodyObject.items : [];
  const draftItems = Array.isArray(draft.analysis.items) ? draft.analysis.items : [];
  if (draftItems.length === 0) {
    const err = new Error('Draft has no item records to save');
    err.status = 422;
    throw err;
  }
  const items = draftItems.map((item, index) => {
    const normalized = normalizeItem({ ...item, ...(overrideItems[index] || {}) }, draft.rawText);
    const resolvedLocation = resolveDraftLocation({
      db,
      draft,
      item: normalized,
      selectedLocationId,
      createSuggestedLocation
    });
    return {
      ...normalized,
      correctedText: draft.analysis.correctedText || normalized.correctedText || draft.rawText,
      locationId: resolvedLocation.locationId,
      location: resolvedLocation.location,
      locationMatchStatus: draft.analysis.locationMatchStatus || normalized.locationMatchStatus || 'unclear',
      locationCandidates: draft.analysis.locationCandidates || normalized.locationCandidates || []
    };
  });
  const saved = items.map((item) => db.createItem(item));
  db.markDraftConfirmed(draftId);
  console.log(`[confirm] saved=${saved.length} draftId=${draftId}`);
  return { draftId, saved };
}

function confirmText(saved) {
  const names = saved.map((item) => item.displayName).join('，');
  const locations = [...new Set(saved.map((item) => item.location).filter(Boolean))].join('，');
  return locations ? `已保存 ${saved.length} 条：${names}。位置：${locations}` : `已保存 ${saved.length} 条：${names}`;
}

export function createRoutes({ config, db, ai }) {
  const router = express.Router();
  router.use(tokenGuard(config));

  router.post('/analyze', async (req, res, next) => {
    try {
      const text = requireText(req.body.text, 'text');
      const history = db.listItems({}).slice(0, 50);
      const locations = db.listLocations({});
      const similarItems = findLocalMatches(history, text, 8);
      const placementCandidates = rankPlacementCandidates(history, { rawText: text }, 5);
      const analysis = await ai.analyze({ text, similarItems, placementCandidates, locations });
      const draft = db.createDraft({ rawText: text, analysis, recommendation: { placementCandidates } });
      res.json({ draftId: draft.id, ...analysis });
    } catch (err) {
      next(err);
    }
  });

  router.post('/confirm', (req, res, next) => {
    try {
      const { saved } = confirmDraft({ db, body: req.body, query: req.query });
      res.json({ ok: true, savedCount: saved.length, items: saved });
    } catch (err) {
      console.warn(`[confirm] failed: ${err.message}`);
      next(err);
    }
  });

  router.post('/confirm-text', (req, res) => {
    try {
      const { saved } = confirmDraft({ db, body: req.body, query: req.query });
      res.type('text/plain').send(confirmText(saved));
    } catch (err) {
      console.warn(`[confirm-text] failed: ${err.message}`);
      res.status(err.status || 500).type('text/plain').send(`保存失败：${err.message}`);
    }
  });

  router.get('/confirm-text', (req, res) => {
    try {
      const { saved } = confirmDraft({ db, body: req.body, query: req.query });
      res.type('text/plain').send(confirmText(saved));
    } catch (err) {
      console.warn(`[confirm-text] failed: ${err.message}`);
      res.status(err.status || 500).type('text/plain').send(`保存失败：${err.message}`);
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

  router.get('/locations', (req, res) => {
    res.json({ locations: db.listLocations({ includeArchived: req.query.includeArchived === '1' }) });
  });

  router.post('/locations', (req, res, next) => {
    try {
      const structuredPath = buildStructuredLocationPath(req.body);
      if (structuredPath) {
        const aliases = normalizeArray(req.body.aliases);
        const location = db.createLocationPath(structuredPath);
        const updated = aliases.length ? db.updateLocation(location.id, { aliases }) : location;
        res.json(updated);
        return;
      }
      if (req.body.path) {
        const aliases = normalizeArray(req.body.aliases);
        const location = db.createLocationPath(req.body.path);
        const updated = aliases.length ? db.updateLocation(location.id, { aliases }) : location;
        res.json(updated);
        return;
      }
      const name = requireText(req.body.name, 'name');
      const location = db.createLocation({
        name,
        parentId: req.body.parentId || req.body.parent_id || null,
        aliases: normalizeArray(req.body.aliases)
      });
      res.json(location);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/locations/:id', (req, res, next) => {
    try {
      const patch = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.parentId !== undefined || req.body.parent_id !== undefined) {
        patch.parentId = req.body.parentId || req.body.parent_id || null;
      }
      if (req.body.aliases !== undefined) patch.aliases = normalizeArray(req.body.aliases);
      if (req.body.status !== undefined) patch.status = req.body.status;
      const location = db.updateLocation(req.params.id, patch);
      if (!location) {
        res.status(404).json({ error: 'Location not found' });
        return;
      }
      res.json(location);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/locations/:id', (req, res) => {
    const location = db.archiveLocation(req.params.id);
    if (!location) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }
    res.json({ ok: true });
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
