import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapItem(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    rawText: row.raw_text,
    description: row.description,
    category: row.category,
    tags: parseJson(row.tags_json, []),
    useContext: row.use_context,
    relatedItems: parseJson(row.related_items_json, []),
    location: row.location,
    zone: row.zone,
    placementReason: row.placement_reason,
    confidence: row.confidence,
    photoPaths: parseJson(row.photo_paths_json, []),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDraft(row) {
  return {
    id: row.id,
    rawText: row.raw_text,
    analysis: parseJson(row.analysis_json, {}),
    recommendation: parseJson(row.recommendation_json, {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createDatabase({ dataDir }) {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new DatabaseSync(join(dataDir, 'storage.db'));
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'uncategorized',
      tags_json TEXT NOT NULL DEFAULT '[]',
      use_context TEXT NOT NULL DEFAULT '',
      related_items_json TEXT NOT NULL DEFAULT '[]',
      location TEXT NOT NULL DEFAULT '',
      zone TEXT NOT NULL DEFAULT '',
      placement_reason TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      photo_paths_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS draft_sessions (
      id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      analysis_json TEXT NOT NULL,
      recommendation_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS item_events (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  return {
    createItem(input) {
      const id = `item_${nanoid(12)}`;
      const timestamp = nowIso();
      sqlite.prepare(`
        INSERT INTO items (
          id, display_name, raw_text, description, category, tags_json, use_context,
          related_items_json, location, zone, placement_reason, confidence,
          photo_paths_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
      `).run(
        id,
        input.displayName || 'Unnamed item',
        input.rawText || '',
        input.description || '',
        input.category || 'uncategorized',
        JSON.stringify(input.tags || []),
        input.useContext || '',
        JSON.stringify(input.relatedItems || []),
        input.location || '',
        input.zone || '',
        input.placementReason || '',
        Number(input.confidence || 0),
        JSON.stringify(input.photoPaths || []),
        timestamp,
        timestamp
      );
      const item = this.getItem(id);
      this.createEvent({ itemId: id, eventType: 'created', before: null, after: item });
      return item;
    },

    getItem(id) {
      const row = sqlite.prepare('SELECT * FROM items WHERE id = ?').get(id);
      return row ? mapItem(row) : null;
    },

    listItems({ includeDeleted = false, query = '' } = {}) {
      const clauses = [];
      const params = {};
      if (!includeDeleted) clauses.push("status != 'deleted'");
      if (query) {
        clauses.push(`(
          display_name LIKE @q OR raw_text LIKE @q OR description LIKE @q OR
          category LIKE @q OR tags_json LIKE @q OR use_context LIKE @q OR
          related_items_json LIKE @q OR location LIKE @q OR zone LIKE @q
        )`);
        params.q = `%${query}%`;
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      return sqlite.prepare(`SELECT * FROM items ${where} ORDER BY updated_at DESC`).all(params).map(mapItem);
    },

    updateItem(id, patch) {
      const before = this.getItem(id);
      if (!before) return null;
      const next = { ...before, ...patch, updatedAt: nowIso() };
      sqlite.prepare(`
        UPDATE items SET
          display_name = ?, raw_text = ?, description = ?, category = ?, tags_json = ?,
          use_context = ?, related_items_json = ?, location = ?, zone = ?,
          placement_reason = ?, confidence = ?, photo_paths_json = ?, status = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        next.displayName,
        next.rawText,
        next.description,
        next.category,
        JSON.stringify(next.tags || []),
        next.useContext,
        JSON.stringify(next.relatedItems || []),
        next.location,
        next.zone,
        next.placementReason,
        Number(next.confidence || 0),
        JSON.stringify(next.photoPaths || []),
        next.status,
        next.updatedAt,
        id
      );
      const after = this.getItem(id);
      this.createEvent({ itemId: id, eventType: 'updated', before, after });
      return after;
    },

    softDeleteItem(id) {
      return this.updateItem(id, { status: 'deleted' });
    },

    createDraft({ rawText, analysis, recommendation }) {
      const id = `draft_${nanoid(12)}`;
      const timestamp = nowIso();
      sqlite.prepare(`
        INSERT INTO draft_sessions (id, raw_text, analysis_json, recommendation_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'draft', ?, ?)
      `).run(id, rawText, JSON.stringify(analysis), JSON.stringify(recommendation), timestamp, timestamp);
      return this.getDraft(id);
    },

    getDraft(id) {
      const row = sqlite.prepare('SELECT * FROM draft_sessions WHERE id = ?').get(id);
      return row ? mapDraft(row) : null;
    },

    markDraftConfirmed(id) {
      sqlite.prepare("UPDATE draft_sessions SET status = 'confirmed', updated_at = ? WHERE id = ?").run(nowIso(), id);
    },

    createEvent({ itemId, eventType, before, after }) {
      sqlite.prepare(`
        INSERT INTO item_events (id, item_id, event_type, before_json, after_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(`evt_${nanoid(12)}`, itemId, eventType, JSON.stringify(before), JSON.stringify(after), nowIso());
    },

    close() {
      sqlite.close();
    }
  };
}
