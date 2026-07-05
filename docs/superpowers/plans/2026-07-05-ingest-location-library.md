# Ingest Location Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the item save flow so the app can keep a user-managed location library, correct noisy iPhone dictation before extraction, match items to existing locations, ask for a location choice when needed, and create a new suggested location when no good match exists.

**Architecture:** Extend the current Express + SQLite app. Keep existing free-text `items.location` for compatibility, add structured `locations` and optional item linkage fields, pass active locations into AI analysis, store match metadata in the draft, and resolve the final location only during confirmation.

**Tech Stack:** Node.js ESM, Express, `node:sqlite`, Vitest, Supertest, static HTML/CSS/JS admin UI, iPhone Shortcuts compatible plain-text confirmation endpoints.

---

## File Structure

- `src/db.js`: add location schema, migrations, mappers, and helper methods.
- `src/routes.js`: add location API routes and update analyze/confirm logic.
- `src/aiPrompts.js`: add dictation correction and location matching prompt contract.
- `src/aiClient.js`: keep parsing strict JSON; normalize new analysis fields if needed.
- `public/admin.html`: add location management section and show corrected/matched location metadata.
- `public/admin.js`: load/create/edit/archive locations; wire item location display.
- `public/admin.css`: add compact location UI styles.
- `tests/db.test.js`: cover schema migration, hierarchy, aliases, and item location metadata.
- `tests/api.test.js`: cover location routes and save-flow variants.
- `tests/aiClient.test.js` or `tests/basic.test.js`: cover prompt output shape or fallback normalization if needed.
- `README.md`: update admin and iPhone Shortcut usage for location choices.

## Implementation Tasks

- [x] 1. Add failing database tests for locations and item metadata.

  Edit `tests/db.test.js`.

  Add tests that create:

  - top-level location `客厅`
  - child location `电视柜`
  - grandchild `左侧抽屉`
  - aliases `["左抽", "客厅抽屉"]`

  Expected assertions:

  ```js
  const room = db.createLocation({ name: '客厅' });
  const cabinet = db.createLocation({ name: '电视柜', parentId: room.id });
  const drawer = db.createLocation({ name: '左侧抽屉', parentId: cabinet.id, aliases: ['左抽', '客厅抽屉'] });

  expect(drawer.path).toBe('客厅 / 电视柜 / 左侧抽屉');
  expect(db.listLocations().map((location) => location.path)).toContain('客厅 / 电视柜 / 左侧抽屉');
  expect(db.getLocation(drawer.id).aliases).toEqual(['左抽', '客厅抽屉']);
  ```

  Add item metadata assertions:

  ```js
  const item = db.createItem({
    displayName: '可乐',
    rawText: '我把可乐放在客厅臭屉',
    correctedText: '我把可乐放在客厅抽屉',
    location: drawer.path,
    locationId: drawer.id,
    locationMatchStatus: 'matched',
    locationCandidates: [{ locationId: drawer.id, path: drawer.path, reason: '房间和抽屉匹配' }]
  });

  expect(item.locationId).toBe(drawer.id);
  expect(item.correctedText).toBe('我把可乐放在客厅抽屉');
  expect(item.locationMatchStatus).toBe('matched');
  expect(item.locationCandidates[0].path).toBe(drawer.path);
  ```

  Run:

  ```bash
  PATH=/Users/litio/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/vitest run tests/db.test.js --pool=threads
  ```

- [x] 2. Implement database migrations and location helpers.

  Edit `src/db.js`.

  Add migration-safe schema changes:

  ```sql
  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    path TEXT NOT NULL UNIQUE,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ```

  Add idempotent column migration helper inside `createDatabase`:

  ```js
  function ensureColumn(table, column, definition) {
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
    if (!columns.includes(column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  ```

  Add `items` columns:

  - `location_id TEXT`
  - `corrected_text TEXT NOT NULL DEFAULT ''`
  - `location_match_status TEXT NOT NULL DEFAULT ''`
  - `location_candidates_json TEXT NOT NULL DEFAULT '[]'`

  Update `mapItem` to include:

  ```js
  locationId: row.location_id || null,
  correctedText: row.corrected_text || row.raw_text,
  locationMatchStatus: row.location_match_status || '',
  locationCandidates: parseJson(row.location_candidates_json, [])
  ```

  Add `mapLocation(row)` returning `{ id, name, parentId, path, aliases, status, createdAt, updatedAt }`.

  Add database methods:

  - `createLocation({ name, parentId = null, aliases = [] })`
  - `getLocation(id)`
  - `getLocationByPath(path)`
  - `listLocations({ includeArchived = false } = {})`
  - `updateLocation(id, patch)`
  - `archiveLocation(id)`
  - `createLocationPath(path)`

  `createLocationPath('书房 / 白色收纳盒')` should create missing segments under existing parents and return the final location.

  Update `createItem` and `updateItem` insert/update statements to persist the new item fields.

  Run the database test command from task 1 until it passes.

- [x] 3. Add failing API tests for location CRUD.

  Edit `tests/api.test.js`.

  Add tests for:

  - `GET /api/locations` returns active locations.
  - `POST /api/locations` creates top-level and child locations.
  - `PATCH /api/locations/:id` updates aliases.
  - `DELETE /api/locations/:id` archives without deleting existing item references.

  Example:

  ```js
  const room = await authed(request(app).post('/api/locations')).send({ name: '客厅' });
  const drawer = await authed(request(app).post('/api/locations')).send({
    name: '左侧抽屉',
    parentId: room.body.id,
    aliases: ['左抽']
  });

  expect(drawer.body.path).toBe('客厅 / 左侧抽屉');
  const list = await authed(request(app).get('/api/locations'));
  expect(list.body.locations[0].path).toBe('客厅 / 左侧抽屉');
  ```

  Run:

  ```bash
  PATH=/Users/litio/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/vitest run tests/api.test.js --pool=threads
  ```

- [x] 4. Implement location API routes.

  Edit `src/routes.js`.

  Add helpers:

  ```js
  function optionalString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }
  ```

  Add routes before item routes:

  - `GET /locations`: `res.json({ locations: db.listLocations({ includeArchived: req.query.includeArchived === '1' }) })`
  - `POST /locations`: validate `name`, optional `parentId`, optional `aliases`.
  - `PATCH /locations/:id`: update `name`, `parentId`, `aliases`, `status` where supplied.
  - `DELETE /locations/:id`: call `db.archiveLocation`.

  Error behavior:

  - Unknown parent returns 400.
  - Unknown location returns 404.
  - Duplicate path returns 409.

  Run the API tests from task 3 until they pass.

- [x] 5. Add failing tests for AI analyze location context and dictation correction fields.

  Edit `tests/api.test.js`.

  Create locations before `/api/analyze`, then assert `ai.analyze` receives active locations:

  ```js
  const room = db.createLocation({ name: '客厅' });
  db.createLocation({ name: '左侧抽屉', parentId: room.id, aliases: ['客厅抽屉'] });

  await authed(request(app).post('/api/analyze')).send({ text: '我把可乐放在客厅臭屉' });

  expect(ai.analyze).toHaveBeenCalledWith(expect.objectContaining({
    text: '我把可乐放在客厅臭屉',
    locations: expect.arrayContaining([
      expect.objectContaining({ path: '客厅 / 左侧抽屉', aliases: ['客厅抽屉'] })
    ])
  }));
  ```

  Adjust the test AI response in `beforeEach` to include:

  ```js
  rawText: '我把可乐放在客厅臭屉',
  correctedText: '我把可乐放在客厅抽屉',
  correctionReason: '将臭屉修正为抽屉',
  locationMatchStatus: 'matched',
  locationId: null,
  locationCandidates: [],
  suggestedLocationPath: ''
  ```

  Assert `/api/analyze` response includes `correctedText`, `locationMatchStatus`, and `draftId`.

- [x] 6. Update AI prompt contract.

  Edit `src/aiPrompts.js`.

  Change `buildAnalyzeMessages({ text, similarItems, placementCandidates })` to accept `locations = []`.

  Add system rules:

  - Correct obvious speech recognition mistakes.
  - Keep uncertain phrases unchanged.
  - Match only against provided active location IDs.
  - Return `needs_choice` when more than one location is plausible.
  - Return `suggested_new` only when the user said enough location detail to create a useful path.
  - Return strict JSON only.

  Update user payload:

  ```js
  {
    task: 'Correct dictation, analyze storage voice input, and match storage location.',
    inputText: text,
    knownLocations: locations.map(({ id, path, aliases }) => ({ id, path, aliases })),
    similarItems,
    placementCandidates,
    outputShape: {
      rawText: 'string',
      correctedText: 'string',
      correctionReason: 'string',
      locationMatchStatus: 'matched | needs_choice | suggested_new | unclear',
      locationId: 'string or null',
      location: 'string',
      locationCandidates: [{ locationId: 'string', path: 'string', reason: 'string' }],
      suggestedLocationPath: 'string',
      suggestedParentPath: 'string',
      items: [/* existing item shape */],
      summary: 'Chinese summary for review'
    }
  }
  ```

  Edit `src/routes.js` so `/api/analyze` calls:

  ```js
  const locations = db.listLocations({});
  const analysis = await ai.analyze({ text, similarItems, placementCandidates, locations });
  ```

  Store the returned analysis unchanged in the draft.

  Run:

  ```bash
  PATH=/Users/litio/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/vitest run tests/api.test.js tests/aiClient.test.js --pool=threads
  ```

- [x] 7. Add failing tests for confirm variants.

  Edit `tests/api.test.js`.

  Add tests for:

  - matched location saves `locationId`, path, corrected text, and status.
  - `needs_choice` draft can be saved with `selectedLocationId`.
  - `suggested_new` draft can be saved with `createSuggestedLocation=true`.
  - `GET /api/confirm-text?draftId=...&selectedLocationId=...` works for Shortcuts.
  - `GET /api/confirm-text?draftId=...&createSuggestedLocation=true` creates the suggested path.

  Example selected-location expectation:

  ```js
  const res = await authed(request(app).get(`/api/confirm-text?draftId=${draft.id}&selectedLocationId=${drawer.id}`));
  expect(res.status).toBe(200);
  expect(db.listItems({})[0].locationId).toBe(drawer.id);
  expect(db.listItems({})[0].location).toBe(drawer.path);
  ```

- [x] 8. Implement confirm resolution logic.

  Edit `src/routes.js`.

  Add helpers:

  - `extractConfirmOptions(body, query)` returning `{ draftId, selectedLocationId, createSuggestedLocation }`.
  - `resolveDraftLocation({ db, draft, item, selectedLocationId, createSuggestedLocation })`.

  Resolution order:

  1. If `selectedLocationId` exists, require that location and use its `id` and `path`.
  2. Else if draft/item has clear `locationId`, require that location and use it.
  3. Else if `createSuggestedLocation` is true and `draft.analysis.suggestedLocationPath` exists, call `db.createLocationPath`.
  4. Else keep free-text `item.location`.

  When normalizing each item, include:

  ```js
  correctedText: draft.analysis.correctedText || item.correctedText || draft.rawText,
  locationId,
  location,
  locationMatchStatus: draft.analysis.locationMatchStatus || item.locationMatchStatus || 'unclear',
  locationCandidates: draft.analysis.locationCandidates || item.locationCandidates || []
  ```

  `confirm-text` responses should mention the final path when possible:

  ```text
  已保存 1 条：可乐。位置：客厅 / 左侧抽屉
  ```

  Run confirm tests from task 7 until they pass.

- [x] 9. Build admin location management UI.

  Edit `public/admin.html`, `public/admin.js`, and `public/admin.css`.

  Add a new admin section near the manual item form:

  - location name input
  - parent location select
  - aliases input using comma-separated text
  - create button
  - flat location table with path, aliases, status, archive button

  `public/admin.js` should add:

  - `let locations = [];`
  - `async function loadLocations()`
  - `function renderLocationOptions()`
  - `function renderLocations()`
  - create handler calling `POST /api/locations`
  - archive handler calling `DELETE /api/locations/:id`

  Existing item table should show structured path when available:

  ```js
  const locationLabel = item.location || item.locationId || '';
  ```

  Keep this screen practical and dense; no large landing-style UI.

- [x] 10. Update documentation and Shortcut notes.

  Edit `README.md`.

  Add:

  - How to create common locations in `/admin.html`.
  - How AI correction works: raw text is preserved, corrected text is saved.
  - How matched locations save directly.
  - How multiple choices can be confirmed through `selectedLocationId`.
  - How suggested new locations can be created through `createSuggestedLocation=true`.

  Include iPhone Shortcut examples:

  ```text
  GET http://NAS_IP:4544/api/confirm-text?draftId=...&selectedLocationId=loc_xxx
  GET http://NAS_IP:4544/api/confirm-text?draftId=...&createSuggestedLocation=true
  ```

- [x] 11. Full verification.

  Run:

  ```bash
  PATH=/Users/litio/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:/Users/litio/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm test -- --pool=threads
  ```

  Start the local app if needed:

  ```bash
  PATH=/Users/litio/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:/Users/litio/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm start
  ```

  Manual smoke checks:

  - `GET /api/locations` requires `X-Storage-Token`.
  - Admin can create `客厅 / 左侧抽屉`.
  - `/api/analyze` creates a draft with `correctedText`.
  - `/api/confirm-text?draftId=...` still saves old matched drafts.
  - `/api/confirm-text?draftId=...&createSuggestedLocation=true` creates a new path and links the item.
  - Existing records remain visible in `/admin.html`.
