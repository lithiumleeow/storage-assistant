# NAS AI Storage Assistant - V1 Design

## Goal

Build a lightweight local storage-memory system for home use. The system runs on a NAS through Docker, uses iPhone Shortcuts as the primary voice-first entry point, and stores long-term memory in a local SQLite database.

The user should not need to manually type item names, categories, or locations during normal use. They speak naturally, review the AI analysis, and confirm save.

## Core Principles

- Voice first: the normal capture and search path starts from iPhone Shortcuts voice input.
- Local persistence: AI does not act as long-term memory. SQLite on the NAS is the source of truth.
- Lightweight deployment: use a small Docker Compose service with mounted data directories.
- Fast enough for daily use: use local database retrieval before calling AI, and keep AI prompts short.
- Free-form locations: the user describes locations naturally instead of choosing from a rigid location tree.
- Graceful fallback: the web admin can correct records when speech or AI analysis is wrong.
- LAN first: V1 is designed for home Wi-Fi access only. Remote access can be added later.

## Primary Users And Context

The primary user has many small household objects stored in drawers, cabinets, boxes, and irregular locations. Many objects are used rarely, so exact recall is difficult later.

Common object types include screws, cables, spare parts, batteries, documents, tools, adapters, household consumables, and unnamed items with only a rough description or usage context.

## V1 Scope

V1 includes:

- NAS Docker deployment.
- SQLite database stored in a mounted NAS volume.
- iPhone Shortcut for recording items by voice.
- iPhone Shortcut for searching items by voice.
- AI-powered natural-language item extraction.
- AI-powered category, tag, usage context, and related-item analysis.
- AI-powered placement recommendation based on historical records.
- Confirmation before saving.
- Simple local web admin for browsing, editing, deleting, and exporting records.
- Optional photo support in the data model and API, but photo upload can remain secondary in the first build.

V1 does not include:

- Public internet access.
- User accounts or multi-user permission management.
- QR code labeling.
- Full inventory quantity tracking.
- Automatic image recognition.
- Native iOS app.
- WeChat mini program.
- Complex fixed location hierarchy.

## System Shape

The system has three parts:

1. iPhone Shortcuts
   - Shortcut: `收纳记录`
   - Shortcut: `查找物品`
   - Uses iOS dictation or Shortcut text input.
   - Calls the NAS HTTP API over the home LAN.
   - Shows AI analysis or search results for user review.

2. NAS Docker backend
   - Node.js + Express HTTP server.
   - SQLite database.
   - Local file storage directory for optional photos and exports.
   - AI provider adapter for DeepSeek or any OpenAI-compatible API.

3. Local web admin
   - Plain HTML, CSS, and JavaScript.
   - Allows review and correction from a phone or desktop browser.
   - Provides backup/export.

## Recommended Technology

- Runtime: Node.js 20.
- Web server: Express.
- Database: SQLite.
- Database library: `better-sqlite3` or `sqlite3`.
- Deployment: Docker Compose.
- Frontend: native HTML/CSS/JS.
- AI API: OpenAI-compatible chat completion endpoint.
- Configuration: environment variables.

Required environment variables:

- `PORT`: server port, default `3000`.
- `BASE_URL`: local URL used by Shortcuts, for example `http://nas.local:3000`.
- `AI_API_KEY`: API key for DeepSeek or other provider.
- `AI_BASE_URL`: OpenAI-compatible base URL.
- `AI_MODEL`: model name, for example a fast low-cost chat model.
- `AI_TIMEOUT_MS`: API timeout, default `12000`.
- `DATA_DIR`: mounted persistent data path, default `/app/data`.
- `SHORTCUT_TOKEN`: shared token required by Shortcut-facing APIs.

## Data Model

### items

Stores confirmed long-term item records.

- `id`: unique ID.
- `display_name`: AI-generated practical name, such as `M3 screws` or `unknown white plastic clips`.
- `raw_text`: original voice transcription or user text.
- `description`: appearance, source, or distinguishing details.
- `category`: broad category, such as `hardware`, `electronics`, `documents`, `medicine`, `daily_supplies`.
- `tags_json`: JSON array of searchable tags.
- `use_context`: usage or source context, such as `chair repair`, `monitor mount`, `spare furniture parts`.
- `related_items_json`: JSON array of related objects or tools.
- `location`: free-form natural-language location.
- `zone`: AI-inferred area label, such as `tool area`, `electronics area`, `spare parts area`.
- `placement_reason`: why this location was recommended or chosen.
- `confidence`: AI confidence from 0 to 1.
- `photo_paths_json`: optional JSON array of local photo paths.
- `status`: `confirmed`, `archived`, or `deleted`.
- `created_at`: ISO timestamp.
- `updated_at`: ISO timestamp.

### draft_sessions

Stores temporary analysis results before confirmation. Drafts allow the Shortcut to preview the analysis and then save only after the user confirms.

- `id`: unique ID.
- `raw_text`: input text.
- `analysis_json`: AI analysis result.
- `recommendation_json`: placement recommendation result.
- `status`: `draft`, `confirmed`, or `expired`.
- `created_at`: ISO timestamp.
- `updated_at`: ISO timestamp.

### item_events

Stores change history.

- `id`: unique ID.
- `item_id`: related item ID.
- `event_type`: `created`, `updated`, `moved`, `deleted`, `restored`.
- `before_json`: previous state, when applicable.
- `after_json`: new state.
- `created_at`: ISO timestamp.

## API Design

All APIs are local LAN HTTP endpoints. V1 uses a simple shared Shortcut token to prevent accidental writes from other LAN devices. This is not full user management; it is a lightweight guard suitable for the home-only first version.

Clients send:

- Header: `X-Storage-Token: <SHORTCUT_TOKEN>`

The token is configured through the `SHORTCUT_TOKEN` environment variable and is stored only in the iPhone Shortcuts and NAS environment file.

### POST /api/analyze

Input:

```json
{
  "text": "我把一包 M3 螺丝和几个垫片放在卧室衣柜右边第三个抽屉透明盒子里"
}
```

Behavior:

1. Retrieve similar historical items and related categories from SQLite.
2. Send the user text plus short historical context to the AI API.
3. Return a draft analysis and placement recommendation.
4. Save a draft session.

Output:

```json
{
  "draftId": "draft_123",
  "items": [
    {
      "displayName": "M3 screws",
      "description": "A pack of M3 screws",
      "category": "hardware",
      "tags": ["screws", "M3", "hardware", "fasteners"],
      "useContext": "repair and assembly",
      "relatedItems": ["washers", "nuts", "screwdriver"],
      "location": "卧室衣柜右边第三个抽屉透明盒子里",
      "zone": "tool area",
      "placementReason": "The location is consistent with existing hardware storage records.",
      "confidence": 0.86
    }
  ],
  "summary": "识别到 2 类五金小物件，建议和已有螺丝、垫片集中存放。"
}
```

### POST /api/confirm

Input:

```json
{
  "draftId": "draft_123",
  "items": [
    {
      "displayName": "M3 screws",
      "location": "卧室衣柜右边第三个抽屉透明盒子里"
    }
  ]
}
```

Behavior:

1. Load the draft.
2. Apply any user-edited fields from the Shortcut or admin UI.
3. Create confirmed item records.
4. Write item event records.

Output:

```json
{
  "ok": true,
  "savedCount": 2
}
```

### POST /api/search

Input:

```json
{
  "query": "我的小螺丝放哪了"
}
```

Behavior:

1. Search local records using keyword matching across names, tags, descriptions, locations, and raw text.
2. Find related category and usage matches.
3. Send the top matches plus the query to AI for concise answer formatting.
4. Return both natural-language answer and structured matches.

Output:

```json
{
  "answer": "你有 3 条可能相关的螺丝记录。大部分在卧室衣柜右边第三个抽屉透明盒子里。",
  "matches": [
    {
      "id": "item_1",
      "displayName": "M3 screws",
      "location": "卧室衣柜右边第三个抽屉透明盒子里",
      "whyMatched": "tags include screws and M3"
    }
  ]
}
```

### POST /api/recommend-location

Input:

```json
{
  "text": "我有一包新的小螺丝，应该放哪里"
}
```

Behavior:

1. Analyze item category and related objects.
2. Query similar items and co-used items.
3. Recommend a location that keeps similar or related items together.

Output:

```json
{
  "recommendedLocation": "卧室衣柜右边第三个抽屉透明盒子里",
  "reason": "你之前的螺丝、垫片和小五金主要集中在这里，继续放这里可以避免分散。",
  "relatedRecords": [
    {
      "displayName": "M3 screws",
      "location": "卧室衣柜右边第三个抽屉透明盒子里"
    }
  ]
}
```

### Admin APIs

- `GET /api/items`: list and filter records.
- `GET /api/items/:id`: read one record.
- `PATCH /api/items/:id`: edit record.
- `DELETE /api/items/:id`: soft delete record.
- `GET /api/export.csv`: export records.
- `GET /api/health`: health check. Does not require `SHORTCUT_TOKEN`.
- `GET /api/version`: deployment version marker.

## AI Behavior

The AI should produce practical household records, not perfect product taxonomy.

For every capture input, AI should:

- Split one sentence into multiple item records when needed.
- Preserve the original wording in `raw_text`.
- Generate a practical temporary name when the exact name is unknown.
- Prefer descriptive names like `unknown white plastic clips` over guessing a precise but unsupported product name.
- Assign one broad category.
- Generate tags that support future fuzzy search.
- Extract source or usage context when present.
- Identify related objects that are likely stored or used together.
- Recommend a placement based on history when possible.
- Explain recommendations briefly.
- Mark low-confidence guesses clearly.

For unnamed objects, AI should not invent certainty. Example:

Input:

`一个白色塑料的小卡扣，不知道干嘛的，可能是儿童床的配件`

Expected analysis:

- `display_name`: `unknown white plastic clip`
- `description`: `white plastic small clip, possible spare part from a child's bed`
- `category`: `spare_parts`
- `tags`: `plastic clip`, `furniture spare part`, `child bed`, `unknown part`
- `use_context`: `possible child bed accessory`
- `confidence`: low or medium

## Placement Recommendation Logic

Recommendation should combine deterministic retrieval with AI summarization.

1. Normalize the new input into candidate category, tags, and related items.
2. Query local database for:
   - Same category.
   - Same or similar tags.
   - Related usage context.
   - Co-used objects.
   - Frequent zones and locations.
3. Rank candidate locations by:
   - Number of similar items already stored there.
   - Recency of confirmed records.
   - Whether co-used items exist nearby.
   - Whether the location is specific enough to be useful.
4. Ask AI to explain the top recommendation in natural language.

Rules:

- Prefer putting all screws and small hardware together.
- Prefer broad simple categories over complex taxonomy.
- Prefer co-locating items that are used together.
- If the user states a location explicitly, respect it and record it.
- If the stated location conflicts with history, warn gently but do not block saving.
- If there is no history, use general household logic and clearly say it is a first-time recommendation.

## iPhone Shortcut Flows

### 收纳记录

1. Ask for dictated text.
2. POST text to `/api/analyze`.
3. Show returned summary and item list.
4. Ask the user to confirm.
5. If confirmed, POST to `/api/confirm`.
6. Show saved count.

Optional future step after V1:

- Ask whether to add a photo.
- Upload photo to a photo endpoint and attach it to the draft or item.

### 查找物品

1. Ask for dictated query.
2. POST query to `/api/search`.
3. Show the natural-language answer.
4. Optionally open the local web detail page for full results.

### 问放哪里

1. Ask for dictated item description.
2. POST text to `/api/recommend-location`.
3. Show recommended location and reason.
4. Optional follow-up: record the item immediately after choosing a location.

## Web Admin Pages

### Dashboard

- Recent saved items.
- Search box.
- Quick filters by category and zone.
- Link to export.

### Item Detail

- Display name.
- Raw text.
- Description.
- Category.
- Tags.
- Usage context.
- Related items.
- Location.
- Placement reason.
- Confidence.
- Optional photos.
- Edit and soft delete actions.

### Draft Review

Optional in V1 if Shortcut confirmation is enough. Useful later for drafts that were not confirmed on the phone.

## Search Strategy

V1 search should be useful without embeddings.

Use:

- SQLite `LIKE` search over name, raw text, description, category, location, and tags JSON.
- Simple token matching for Chinese and English fragments.
- AI answer formatting after local retrieval.

Future upgrade:

- Add embeddings for semantic search if keyword search is not enough.
- Store vectors locally or with a lightweight vector table.

## Speed And Cost Strategy

- Keep AI calls short.
- Search locally before AI.
- Send only top relevant history snippets to AI.
- Use a fast low-cost model by default.
- Cache draft analysis and search formatting when useful.
- Set strict API timeouts.
- If AI fails, return local keyword results instead of failing the whole search.

## Privacy And Network Boundary

V1 assumes the service is only reachable on the home LAN.

The NAS sends text to the configured AI API provider. API keys stay on the NAS and are not stored in iPhone Shortcuts.

Future remote access can be added with:

- VPN.
- Tailscale.
- Reverse proxy with HTTPS and authentication.
- Stronger authentication beyond the V1 shared Shortcut token.

These are out of V1 scope.

## Backup And Durability

The Docker Compose file must mount persistent volumes:

- `/app/data/storage.db`
- `/app/data/photos`
- `/app/data/exports`

The app should provide CSV export from the web admin.

The README should document backing up the mounted `data` directory.

## Error Handling

- AI API timeout: return a clear error and keep the original input available for retry.
- AI malformed JSON: retry once with a repair prompt; if still invalid, return a failure message.
- Database write failure: do not report successful save.
- Empty voice input: ask the Shortcut user to try again.
- Search with no matches: say no matching record was found and suggest broader terms.
- Duplicate-looking item: save as a new item by default, but show similar existing items in the result.

## Testing Strategy

Automated tests should cover:

- Database migrations.
- Analyze endpoint with mocked AI response.
- Confirm endpoint creating item records.
- Search endpoint matching by name, tag, location, raw text, and usage context.
- Placement recommendation ranking from seeded history.
- AI JSON parsing and malformed response fallback.
- CSV export.

Manual verification should cover:

- Docker Compose starts cleanly.
- Data persists after container restart.
- iPhone Shortcut can reach the NAS URL on home Wi-Fi.
- Voice input can be confirmed and saved.
- Search returns useful answers for vague queries.

## Implementation Order

1. Create Node.js + Express + SQLite Docker scaffold.
2. Add database schema and migrations.
3. Add AI provider adapter.
4. Add `/api/analyze`, `/api/confirm`, `/api/search`, and `/api/recommend-location`.
5. Add minimal web admin.
6. Add CSV export.
7. Add README with Docker Compose and Shortcut setup instructions.
8. Verify with mocked AI and then real API credentials.

## V1 Decisions

- V1 requires a simple shared `SHORTCUT_TOKEN` on Shortcut-facing APIs, even though the app is LAN-only.
- Optional photo fields stay in the schema, but photo upload is not part of the first implementation plan unless explicitly requested later.
- `.env.example` should use DeepSeek-style OpenAI-compatible settings as the default cheap API example, while keeping the provider configurable.
