# NAS AI Storage Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V1 NAS Docker app for voice-first storage records, AI analysis, long-term SQLite persistence, fuzzy search, placement recommendations, and a simple web admin.

**Architecture:** A small Node.js 20 + Express service owns all backend APIs, static admin pages, AI-provider calls, and SQLite persistence under a mounted `/app/data` directory. iPhone Shortcuts call JSON APIs over the home LAN using `X-Storage-Token`; the app retrieves local history first and uses an OpenAI-compatible AI API only for analysis and summarization.

**Tech Stack:** Node.js 24, Express, built-in `node:sqlite`, Vitest, Supertest, native HTML/CSS/JS, Docker Compose, OpenAI-compatible chat completion API.

---

## File Structure

- `package.json`: npm scripts and dependencies.
- `src/config.js`: read and validate environment settings.
- `src/db.js`: built-in SQLite connection, migrations, and row mapping helpers.
- `src/search.js`: local keyword retrieval and placement-candidate ranking.
- `src/aiClient.js`: OpenAI-compatible API adapter and JSON parsing helpers.
- `src/aiPrompts.js`: prompt builders for analyze, search summary, and location recommendation.
- `src/routes.js`: Express API routes and token guard.
- `src/server.js`: app factory and server startup.
- `public/admin.html`: admin shell.
- `public/admin.css`: mobile-friendly admin styling.
- `public/admin.js`: browser-side admin interactions.
- `tests/db.test.js`: migration and persistence tests.
- `tests/aiClient.test.js`: mocked AI adapter tests.
- `tests/api.test.js`: endpoint tests with mocked AI.
- `tests/search.test.js`: local search and placement ranking tests.
- `.env.example`: DeepSeek-style OpenAI-compatible example config.
- `Dockerfile`: production container.
- `docker-compose.yml`: NAS deployment with persistent `./data` mount.
- `README.md`: local run, Docker deployment, and iPhone Shortcut setup.

---

### Task 1: Project Scaffold And Test Harness

**Files:**
- Create: `package.json`
- Create: `src/server.js`
- Create: `src/config.js`
- Create: `tests/basic.test.js`
- Create: `.gitignore`

- [x] **Step 1: Create package metadata and scripts**

Create `package.json`:

```json
{
  "name": "nas-ai-storage-assistant",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^4.21.2",
    "nanoid": "^5.1.5"
  },
  "devDependencies": {
    "supertest": "^7.1.1",
    "vitest": "^3.2.4"
  }
}
```

- [x] **Step 2: Add config module**

Create `src/config.js`:

```js
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,
    dataDir: env.DATA_DIR || './data',
    shortcutToken: env.SHORTCUT_TOKEN || 'dev-token',
    aiApiKey: env.AI_API_KEY || '',
    aiBaseUrl: env.AI_BASE_URL || 'https://api.deepseek.com',
    aiModel: env.AI_MODEL || 'deepseek-chat',
    aiTimeoutMs: Number(env.AI_TIMEOUT_MS || 12000),
    version: env.APP_VERSION || 'dev'
  };
}
```

- [x] **Step 3: Add minimal Express app factory**

Create `src/server.js`:

```js
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
```

- [x] **Step 4: Add a smoke test**

Create `tests/basic.test.js`:

```js
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';

describe('basic app', () => {
  it('responds to health checks', async () => {
    const app = createApp({ config: { version: 'test' } });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns the configured version marker', async () => {
    const app = createApp({ config: { version: 'test-version' } });
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: 'test-version' });
  });
});
```

- [x] **Step 5: Add gitignore**

Create `.gitignore`:

```gitignore
node_modules/
data/
.env
.DS_Store
coverage/
```

- [x] **Step 6: Install dependencies**

Run: `pnpm install`

Expected: `pnpm-lock.yaml` is created and pnpm exits successfully.

- [x] **Step 7: Run scaffold tests**

Run: `npm test`

Expected: `2 passed`.

- [x] **Step 8: Commit scaffold**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml src/server.js src/config.js tests/basic.test.js .gitignore
git commit -m "feat: scaffold storage assistant app"
```

---

### Task 2: SQLite Schema And Repository Helpers

**Files:**
- Create: `src/db.js`
- Create: `tests/db.test.js`
- Modify: `src/server.js`

- [x] **Step 1: Write database tests**

Create `tests/db.test.js`:

```js
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db.js';

let dir;
let db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'storage-db-'));
  db = createDatabase({ dataDir: dir });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('database', () => {
  it('creates confirmed items and reads them back', () => {
    const item = db.createItem({
      displayName: 'M3 screws',
      rawText: '我把一包 M3 螺丝放在工具盒',
      description: 'A pack of M3 screws',
      category: 'hardware',
      tags: ['screws', 'M3'],
      useContext: 'repair',
      relatedItems: ['washers'],
      location: '工具盒',
      zone: 'tool area',
      placementReason: 'Same as other hardware',
      confidence: 0.9,
      photoPaths: []
    });

    expect(item.id).toMatch(/^item_/);
    const rows = db.listItems({});
    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe('M3 screws');
    expect(rows[0].tags).toEqual(['screws', 'M3']);
  });

  it('creates and confirms a draft session', () => {
    const draft = db.createDraft({
      rawText: '白色塑料卡扣在儿童床配件袋里',
      analysis: { items: [{ displayName: 'unknown white plastic clip' }] },
      recommendation: { recommendedLocation: '儿童床配件袋' }
    });

    expect(draft.id).toMatch(/^draft_/);
    db.markDraftConfirmed(draft.id);
    const saved = db.getDraft(draft.id);
    expect(saved.status).toBe('confirmed');
  });

  it('soft deletes items without removing history', () => {
    const item = db.createItem({
      displayName: 'USB-C cable',
      rawText: '线放在抽屉',
      description: '',
      category: 'electronics',
      tags: ['cable'],
      useContext: 'charging',
      relatedItems: [],
      location: '抽屉',
      zone: 'electronics area',
      placementReason: '',
      confidence: 0.8,
      photoPaths: []
    });

    db.softDeleteItem(item.id);
    expect(db.listItems({ includeDeleted: true })[0].status).toBe('deleted');
    expect(db.listItems({})).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run failing database tests**

Run: `npm test -- tests/db.test.js`

Expected: FAIL because `src/db.js` does not exist.

- [x] **Step 3: Implement database module**

Create `src/db.js`:

```js
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
```

- [x] **Step 4: Run database tests**

Run: `pnpm test -- tests/db.test.js`

Expected: PASS.

- [x] **Step 5: Commit database layer**

```bash
git add src/db.js tests/db.test.js
git commit -m "feat: add sqlite persistence"
```

---

### Task 3: Local Search And Placement Ranking

**Files:**
- Create: `src/search.js`
- Create: `tests/search.test.js`

- [ ] **Step 1: Write search tests**

Create `tests/search.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { findLocalMatches, rankPlacementCandidates } from '../src/search.js';

const items = [
  {
    id: 'item_1',
    displayName: 'M3 screws',
    rawText: 'M3 螺丝放在卧室衣柜右边第三个抽屉透明盒子',
    description: 'small screws',
    category: 'hardware',
    tags: ['螺丝', 'M3', '五金'],
    useContext: 'repair',
    relatedItems: ['垫片', '螺丝刀'],
    location: '卧室衣柜右边第三个抽屉透明盒子',
    zone: 'tool area',
    updatedAt: '2026-06-20T00:00:00.000Z'
  },
  {
    id: 'item_2',
    displayName: 'USB-C cable',
    rawText: '数据线在书桌抽屉',
    description: 'charging cable',
    category: 'electronics',
    tags: ['Type-C', '充电线'],
    useContext: 'charging',
    relatedItems: ['充电器'],
    location: '书桌抽屉',
    zone: 'electronics area',
    updatedAt: '2026-06-19T00:00:00.000Z'
  }
];

describe('search helpers', () => {
  it('matches Chinese tags and raw text', () => {
    const matches = findLocalMatches(items, '小螺丝在哪里');
    expect(matches[0].id).toBe('item_1');
    expect(matches[0].whyMatched).toContain('螺丝');
  });

  it('matches by usage context and related items', () => {
    const matches = findLocalMatches(items, '维修用的小东西');
    expect(matches[0].id).toBe('item_1');
  });

  it('ranks repeated hardware locations first', () => {
    const ranked = rankPlacementCandidates(items, {
      category: 'hardware',
      tags: ['螺丝'],
      relatedItems: ['垫片']
    });
    expect(ranked[0].location).toBe('卧室衣柜右边第三个抽屉透明盒子');
    expect(ranked[0].score).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run failing search tests**

Run: `npm test -- tests/search.test.js`

Expected: FAIL because `src/search.js` does not exist.

- [ ] **Step 3: Implement local search helpers**

Create `src/search.js`:

```js
function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

function collectTerms(item) {
  return [
    item.displayName,
    item.rawText,
    item.description,
    item.category,
    ...(item.tags || []),
    item.useContext,
    ...(item.relatedItems || []),
    item.location,
    item.zone
  ].filter(Boolean).map(normalize);
}

function tokenize(query) {
  const normalized = normalize(query);
  const latin = normalized.split(/[\s,，。！？!?/]+/).filter(Boolean);
  const chineseHints = ['螺丝', '垫片', '电池', '线', '充电', '维修', '配件', '卡扣', '工具', '文件'];
  return [...new Set([...latin, ...chineseHints.filter((term) => normalized.includes(term))])];
}

export function findLocalMatches(items, query, limit = 10) {
  const tokens = tokenize(query);
  return items
    .map((item) => {
      const terms = collectTerms(item);
      const matched = tokens.filter((token) => terms.some((term) => term.includes(token) || token.includes(term)));
      const fuzzyUseBoost = normalize(query).includes('维修') && terms.some((term) => term.includes('repair'));
      const score = matched.length * 10 + (fuzzyUseBoost ? 5 : 0);
      return { ...item, score, whyMatched: matched.join(', ') || (fuzzyUseBoost ? 'repair' : '') };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
}

export function rankPlacementCandidates(items, candidate, limit = 5) {
  const candidateTerms = collectTerms({
    displayName: candidate.displayName,
    rawText: candidate.rawText,
    description: candidate.description,
    category: candidate.category,
    tags: candidate.tags,
    useContext: candidate.useContext,
    relatedItems: candidate.relatedItems,
    location: '',
    zone: candidate.zone
  });
  const buckets = new Map();
  for (const item of items) {
    if (!item.location) continue;
    const terms = collectTerms(item);
    let score = 0;
    if (candidate.category && normalize(candidate.category) === normalize(item.category)) score += 8;
    for (const term of candidateTerms) {
      if (terms.some((existing) => existing.includes(term) || term.includes(existing))) score += 2;
    }
    if (score <= 0) continue;
    const existing = buckets.get(item.location) || { location: item.location, zone: item.zone, score: 0, relatedRecords: [] };
    existing.score += score;
    existing.relatedRecords.push(item);
    buckets.set(item.location, existing);
  }
  return [...buckets.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
```

- [ ] **Step 4: Run search tests**

Run: `npm test -- tests/search.test.js`

Expected: PASS.

- [ ] **Step 5: Commit search helpers**

```bash
git add src/search.js tests/search.test.js
git commit -m "feat: add local search helpers"
```

---

### Task 4: AI Client And Prompt Builders

**Files:**
- Create: `src/aiClient.js`
- Create: `src/aiPrompts.js`
- Create: `tests/aiClient.test.js`

- [ ] **Step 1: Write AI client tests**

Create `tests/aiClient.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { callJsonModel, parseJsonObject } from '../src/aiClient.js';

describe('AI client', () => {
  it('parses plain JSON objects', () => {
    expect(parseJsonObject('{"items":[{"displayName":"M3 screws"}]}')).toEqual({
      items: [{ displayName: 'M3 screws' }]
    });
  });

  it('parses fenced JSON objects', () => {
    expect(parseJsonObject('```json\\n{"answer":"ok"}\\n```')).toEqual({ answer: 'ok' });
  });

  it('calls an OpenAI-compatible chat completion endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"answer":"done"}' } }]
      })
    }));

    const result = await callJsonModel({
      config: {
        aiBaseUrl: 'https://api.example.com',
        aiApiKey: 'key',
        aiModel: 'cheap-model',
        aiTimeoutMs: 1000
      },
      messages: [{ role: 'user', content: 'hello' }],
      fetchImpl: fetchMock
    });

    expect(result).toEqual({ answer: 'done' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer key' })
      })
    );
  });
});
```

- [ ] **Step 2: Run failing AI tests**

Run: `npm test -- tests/aiClient.test.js`

Expected: FAIL because `src/aiClient.js` does not exist.

- [ ] **Step 3: Implement AI client**

Create `src/aiClient.js`:

```js
export function parseJsonObject(text) {
  const cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('AI response did not contain a JSON object');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function callJsonModel({ config, messages, fetchImpl = fetch }) {
  if (!config.aiApiKey) {
    throw new Error('AI_API_KEY is required for AI calls');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs || 12000);
  try {
    const res = await fetchImpl(`${config.aiBaseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.aiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.aiModel,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`AI API failed with HTTP ${res.status}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || '';
    return parseJsonObject(content);
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Implement prompt builders**

Create `src/aiPrompts.js`:

```js
export function buildAnalyzeMessages({ text, similarItems, placementCandidates }) {
  return [
    {
      role: 'system',
      content: [
        'You are a household storage assistant.',
        'Return strict JSON only.',
        'Do not invent precise product names when the user is uncertain.',
        'Use practical broad categories and search-friendly tags.',
        'If the user states a location, preserve it.'
      ].join(' ')
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Analyze storage voice input into item records.',
        inputText: text,
        similarItems,
        placementCandidates,
        outputShape: {
          items: [
            {
              displayName: 'string',
              description: 'string',
              category: 'string',
              tags: ['string'],
              useContext: 'string',
              relatedItems: ['string'],
              location: 'string',
              zone: 'string',
              placementReason: 'string',
              confidence: 0.8
            }
          ],
          summary: 'Chinese summary for review'
        }
      })
    }
  ];
}

export function buildSearchSummaryMessages({ query, matches }) {
  return [
    { role: 'system', content: 'You summarize household storage search results in concise Chinese. Return strict JSON only.' },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Answer where the requested objects might be.',
        query,
        matches,
        outputShape: { answer: 'string', matches: [{ id: 'string', displayName: 'string', location: 'string', whyMatched: 'string' }] }
      })
    }
  ];
}

export function buildRecommendationMessages({ text, candidates }) {
  return [
    { role: 'system', content: 'You recommend household storage locations based on history. Return strict JSON only.' },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Recommend where to place this object.',
        inputText: text,
        candidates,
        rules: [
          'Keep screws and small hardware together.',
          'Keep similar products in the same area.',
          'Keep co-used items near each other.',
          'If no history exists, say this is a first-time recommendation.'
        ],
        outputShape: { recommendedLocation: 'string', reason: 'string', relatedRecords: [] }
      })
    }
  ];
}
```

- [ ] **Step 5: Run AI tests**

Run: `npm test -- tests/aiClient.test.js`

Expected: PASS.

- [ ] **Step 6: Commit AI client**

```bash
git add src/aiClient.js src/aiPrompts.js tests/aiClient.test.js
git commit -m "feat: add openai compatible ai client"
```

---

### Task 5: Core API Routes

**Files:**
- Create: `src/routes.js`
- Create: `tests/api.test.js`
- Modify: `src/server.js`

- [ ] **Step 1: Write API tests**

Create `tests/api.test.js`:

```js
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server.js';
import { createDatabase } from '../src/db.js';

let dir;
let db;
let ai;
let app;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'storage-api-'));
  db = createDatabase({ dataDir: dir });
  ai = {
    analyze: vi.fn(async () => ({
      items: [{
        displayName: 'M3 screws',
        description: 'A pack of M3 screws',
        category: 'hardware',
        tags: ['螺丝', 'M3'],
        useContext: 'repair',
        relatedItems: ['垫片'],
        location: '工具盒',
        zone: 'tool area',
        placementReason: 'Keep hardware together',
        confidence: 0.9
      }],
      summary: '识别到 M3 螺丝'
    })),
    summarizeSearch: vi.fn(async ({ matches }) => ({ answer: '螺丝在工具盒', matches })),
    recommendLocation: vi.fn(async () => ({ recommendedLocation: '工具盒', reason: '已有五金在这里', relatedRecords: [] }))
  };
  app = createApp({ config: { version: 'test', shortcutToken: 'secret' }, db, ai });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function authed(req) {
  return req.set('X-Storage-Token', 'secret');
}

describe('API routes', () => {
  it('rejects protected routes without token', async () => {
    const res = await request(app).post('/api/analyze').send({ text: 'hello' });
    expect(res.status).toBe(401);
  });

  it('analyzes text and creates a draft', async () => {
    const res = await authed(request(app).post('/api/analyze')).send({ text: '螺丝放在工具盒' });
    expect(res.status).toBe(200);
    expect(res.body.draftId).toMatch(/^draft_/);
    expect(res.body.items[0].displayName).toBe('M3 screws');
  });

  it('confirms a draft into item records', async () => {
    const draft = await authed(request(app).post('/api/analyze')).send({ text: '螺丝放在工具盒' });
    const res = await authed(request(app).post('/api/confirm')).send({ draftId: draft.body.draftId });
    expect(res.status).toBe(200);
    expect(res.body.savedCount).toBe(1);
    expect(db.listItems({})[0].displayName).toBe('M3 screws');
  });

  it('searches stored items', async () => {
    db.createItem({
      displayName: 'M3 screws',
      rawText: '螺丝放在工具盒',
      description: '',
      category: 'hardware',
      tags: ['螺丝'],
      useContext: 'repair',
      relatedItems: [],
      location: '工具盒',
      zone: 'tool area',
      placementReason: '',
      confidence: 0.9,
      photoPaths: []
    });
    const res = await authed(request(app).post('/api/search')).send({ query: '螺丝在哪里' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('工具盒');
  });

  it('lists and edits admin items', async () => {
    const item = db.createItem({
      displayName: 'USB-C cable',
      rawText: '线放在抽屉',
      description: '',
      category: 'electronics',
      tags: ['线'],
      useContext: 'charging',
      relatedItems: [],
      location: '抽屉',
      zone: 'electronics area',
      placementReason: '',
      confidence: 0.8,
      photoPaths: []
    });
    const patch = await authed(request(app).patch(`/api/items/${item.id}`)).send({ location: '书桌抽屉' });
    expect(patch.body.location).toBe('书桌抽屉');
    const list = await authed(request(app).get('/api/items'));
    expect(list.body.items[0].location).toBe('书桌抽屉');
  });
});
```

- [ ] **Step 2: Run failing API tests**

Run: `npm test -- tests/api.test.js`

Expected: FAIL because routes are not wired.

- [ ] **Step 3: Implement routes**

Create `src/routes.js`:

```js
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
```

- [ ] **Step 4: Wire routes and default AI service**

Modify `src/server.js`:

```js
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
  const config = options.config || loadConfig();
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
```

- [ ] **Step 5: Run API tests**

Run: `npm test -- tests/api.test.js`

Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit API routes**

```bash
git add src/routes.js src/server.js tests/api.test.js
git commit -m "feat: add storage assistant api"
```

---

### Task 6: Web Admin And Export Verification

**Files:**
- Create: `public/admin.html`
- Create: `public/admin.css`
- Create: `public/admin.js`
- Modify: `tests/api.test.js`

- [ ] **Step 1: Add export test**

Append to `tests/api.test.js`:

```js
  it('exports CSV records', async () => {
    db.createItem({
      displayName: 'Battery',
      rawText: '电池放在柜子',
      description: '',
      category: 'daily_supplies',
      tags: ['电池'],
      useContext: 'backup power',
      relatedItems: [],
      location: '柜子',
      zone: 'supplies area',
      placementReason: '',
      confidence: 0.8,
      photoPaths: []
    });
    const res = await authed(request(app).get('/api/export.csv'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Battery');
    expect(res.text).toContain('柜子');
  });
```

- [ ] **Step 2: Run API tests**

Run: `npm test -- tests/api.test.js`

Expected: PASS because CSV route already exists.

- [ ] **Step 3: Create admin HTML**

Create `public/admin.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>收纳记忆</title>
    <link rel="stylesheet" href="/admin.css">
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <h1>收纳记忆</h1>
        <a id="exportLink" href="/api/export.csv">导出 CSV</a>
      </header>

      <section class="panel">
        <label for="token">访问令牌</label>
        <input id="token" type="password" placeholder="SHORTCUT_TOKEN">
      </section>

      <section class="panel">
        <label for="search">搜索</label>
        <input id="search" type="search" placeholder="螺丝、充电线、修椅子用的东西">
      </section>

      <section id="items" class="items"></section>
    </main>
    <script src="/admin.js"></script>
  </body>
</html>
```

- [ ] **Step 4: Create admin CSS**

Create `public/admin.css`:

```css
:root {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f5f7f8;
  color: #172026;
}

body {
  margin: 0;
}

.shell {
  max-width: 920px;
  margin: 0 auto;
  padding: 18px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

h1 {
  margin: 0;
  font-size: 24px;
}

a, button {
  color: #0f5f8c;
}

.panel {
  display: grid;
  gap: 8px;
  margin: 12px 0;
}

label {
  font-size: 13px;
  color: #52606b;
}

input, textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #c9d2d9;
  border-radius: 8px;
  padding: 11px 12px;
  font: inherit;
  background: white;
}

.items {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.item {
  background: white;
  border: 1px solid #dbe2e7;
  border-radius: 8px;
  padding: 14px;
  display: grid;
  gap: 8px;
}

.item h2 {
  margin: 0;
  font-size: 17px;
}

.meta {
  color: #52606b;
  font-size: 13px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  border: 1px solid #d0dae0;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 12px;
  color: #344955;
}

.actions {
  display: flex;
  gap: 8px;
}

button {
  border: 1px solid #b8c7d1;
  border-radius: 8px;
  background: #ffffff;
  padding: 8px 10px;
  font: inherit;
}
```

- [ ] **Step 5: Create admin JS**

Create `public/admin.js`:

```js
const tokenInput = document.querySelector('#token');
const searchInput = document.querySelector('#search');
const itemsEl = document.querySelector('#items');
const exportLink = document.querySelector('#exportLink');

tokenInput.value = localStorage.getItem('storage-token') || '';

function headers() {
  const token = tokenInput.value.trim();
  localStorage.setItem('storage-token', token);
  return { 'X-Storage-Token': token, 'Content-Type': 'application/json' };
}

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

async function loadItems() {
  const q = encodeURIComponent(searchInput.value.trim());
  exportLink.href = `/api/export.csv`;
  const res = await fetch(`/api/items?q=${q}`, { headers: headers() });
  if (!res.ok) {
    itemsEl.innerHTML = '<p class="meta">无法加载记录，请检查访问令牌。</p>';
    return;
  }
  const data = await res.json();
  itemsEl.innerHTML = data.items.map((item) => `
    <article class="item">
      <h2>${esc(item.displayName)}</h2>
      <div class="meta">${esc(item.category)} · ${esc(item.zone || '未标记区域')}</div>
      <div><strong>位置：</strong>${esc(item.location || '未记录')}</div>
      <div><strong>描述：</strong>${esc(item.description || item.rawText)}</div>
      <div class="tags">${(item.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div>
      <div class="actions">
        <button data-edit="${esc(item.id)}">修改位置</button>
        <button data-delete="${esc(item.id)}">删除</button>
      </div>
    </article>
  `).join('') || '<p class="meta">还没有记录。</p>';
}

itemsEl.addEventListener('click', async (event) => {
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;
  if (editId) {
    const location = prompt('新的位置');
    if (!location) return;
    await fetch(`/api/items/${editId}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ location })
    });
    loadItems();
  }
  if (deleteId && confirm('确定删除这条记录吗？')) {
    await fetch(`/api/items/${deleteId}`, { method: 'DELETE', headers: headers() });
    loadItems();
  }
});

tokenInput.addEventListener('change', loadItems);
searchInput.addEventListener('input', () => {
  clearTimeout(window.searchTimer);
  window.searchTimer = setTimeout(loadItems, 200);
});

loadItems();
```

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit admin**

```bash
git add public/admin.html public/admin.css public/admin.js tests/api.test.js
git commit -m "feat: add local admin page"
```

---

### Task 7: Docker, Environment, README, And Shortcut Instructions

**Files:**
- Create: `.env.example`
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `README.md`

- [ ] **Step 1: Create environment example**

Create `.env.example`:

```dotenv
PORT=3000
BASE_URL=http://nas.local:3000
DATA_DIR=/app/data
SHORTCUT_TOKEN=change-this-local-token
AI_API_KEY=your_deepseek_or_openai_compatible_key
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat
AI_TIMEOUT_MS=12000
APP_VERSION=2026-06-21-v1
```

- [ ] **Step 2: Create Dockerfile**

Create `Dockerfile`:

```Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY public ./public
EXPOSE 3000
CMD ["node", "src/server.js"]
```

- [ ] **Step 3: Create Docker Compose file**

Create `docker-compose.yml`:

```yaml
services:
  storage-assistant:
    build: .
    container_name: storage-assistant
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
```

- [ ] **Step 4: Create README**

Create `README.md`:

```md
# NAS AI Storage Assistant

本项目是一个运行在 NAS Docker 里的家庭收纳记忆系统。日常入口是 iPhone 快捷指令：你用语音描述物品和位置，服务端调用 DeepSeek/OpenAI 兼容 API 分析，确认后长期保存到 NAS 本地 SQLite 数据库。

## 本地运行

```bash
npm install
cp .env.example .env
npm test
npm start
```

打开：

```text
http://localhost:3000/admin.html
```

## Docker 部署

```bash
cp .env.example .env
docker compose up -d --build
```

数据保存在：

```text
./data/storage.db
./data/photos
./data/exports
```

备份时复制整个 `data` 目录。

## iPhone 快捷指令：收纳记录

1. 添加“听写文本”动作。
2. 添加“获取 URL 内容”动作。
3. URL 设置为 `http://你的NAS地址:3000/api/analyze`。
4. 方法选择 `POST`。
5. 请求正文选择 JSON：`{"text":"听写文本变量"}`。
6. 请求头添加 `X-Storage-Token`，值为 `.env` 里的 `SHORTCUT_TOKEN`。
7. 显示返回的 `summary` 和 `items`。
8. 如果确认保存，再请求 `POST /api/confirm`，正文为 `{"draftId":"上一步返回的 draftId"}`。

## iPhone 快捷指令：查找物品

1. 添加“听写文本”动作。
2. 请求 `POST http://你的NAS地址:3000/api/search`。
3. 请求正文 JSON：`{"query":"听写文本变量"}`。
4. 请求头添加 `X-Storage-Token`。
5. 显示返回的 `answer`。

## 常用接口

- `GET /api/health`
- `GET /api/version`
- `POST /api/analyze`
- `POST /api/confirm`
- `POST /api/search`
- `POST /api/recommend-location`
- `GET /api/items`
- `GET /api/export.csv`
```

- [ ] **Step 5: Run full tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Build Docker image**

Run: `docker compose build`

Expected: Docker image builds successfully.

If Docker is unavailable in the current environment, record the exact error and still keep the Docker files committed.

- [ ] **Step 7: Commit deployment docs**

```bash
git add .env.example Dockerfile docker-compose.yml README.md
git commit -m "docs: add docker deployment instructions"
```

---

### Task 8: Final Verification

**Files:**
- Modify only if verification exposes a real defect.

- [ ] **Step 1: Run all automated tests**

Run: `npm test`

Expected: all test files pass.

- [ ] **Step 2: Start the local server**

Run: `PORT=3010 DATA_DIR=./data-dev SHORTCUT_TOKEN=dev-token AI_API_KEY=test npm start`

Expected: server prints `Storage assistant listening on 3010`.

- [ ] **Step 3: Verify health endpoint**

Run in another terminal:

```bash
curl http://localhost:3010/api/health
```

Expected:

```json
{"ok":true}
```

- [ ] **Step 4: Verify token protection**

Run:

```bash
curl -s -o /tmp/storage-status.txt -w "%{http_code}" -X POST http://localhost:3010/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"螺丝"}'
```

Expected: `401`.

- [ ] **Step 5: Verify admin page loads**

Open `http://localhost:3010/admin.html` in a browser or use:

```bash
curl -I http://localhost:3010/admin.html
```

Expected: HTTP `200`.

- [ ] **Step 6: Stop server**

Stop the npm process with `Ctrl-C`.

- [ ] **Step 7: Final git status**

Run: `git status --short --branch`

Expected: clean working tree on `main`.

---

## Self-Review Notes

- Spec coverage: the plan covers NAS Docker deployment, SQLite persistence, Shortcut-facing APIs, AI analysis, search, placement recommendation, web admin, CSV export, token guard, and LAN-only assumptions.
- V1 exclusions preserved: no public internet access, no native iOS app, no WeChat mini program, no QR labels, no automatic image recognition, and no required photo upload.
- Placeholder scan: no unresolved placeholder markers remain.
- Type consistency: route response fields use camelCase externally and database fields map to camelCase in JS helpers.
