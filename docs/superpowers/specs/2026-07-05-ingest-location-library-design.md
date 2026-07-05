# Ingest Location Library V2 Design

## Goal

Improve only the item ingest/save flow. Search and retrieval behavior remain mostly unchanged for this iteration.

The new ingest flow should:

- Let the user maintain common storage locations in the admin UI.
- Let AI correct noisy iPhone dictation before item extraction.
- Let AI match corrected text to existing locations.
- Let AI suggest a new location when no existing location fits.
- Let the user choose among multiple candidate locations before saving.

## Non-Goals

- Do not redesign item search.
- Do not add semantic search or embeddings.
- Do not add photos.
- Do not add multi-user accounts.
- Do not require a native app.

## Location Model

Add a `locations` table.

Fields:

- `id`: unique ID.
- `name`: local segment name, such as `卧室`, `衣柜`, `右侧第三个抽屉`.
- `parent_id`: nullable parent location ID.
- `path`: full display path, such as `卧室 / 衣柜 / 右侧第三个抽屉`.
- `aliases_json`: optional aliases, such as `["右三抽", "第三抽屉"]`.
- `status`: `active` or `archived`.
- `created_at`: ISO timestamp.
- `updated_at`: ISO timestamp.

Items keep their current free-text `location`, and gain optional fields:

- `location_id`: matched location ID.
- `corrected_text`: AI-corrected dictation text.
- `location_match_status`: `matched`, `needs_choice`, `suggested_new`, or `unclear`.
- `location_candidates_json`: candidate locations shown during confirmation.

Keeping the free-text location avoids breaking existing records.

## Admin UI

Add a simple location management section.

V2 admin features:

- Create a top-level location, such as `卧室`.
- Create a child location under an existing location, such as `衣柜`.
- View locations as full paths.
- Archive a location instead of hard deleting it.
- Edit aliases for a location.

The UI can stay plain and utilitarian. A nested tree is nice but not required for V2; a flat list of full paths is acceptable.

## AI Dictation Correction

The AI analysis step should return:

- `rawText`: original dictated text.
- `correctedText`: corrected text.
- `correctionReason`: short explanation when useful.

Rules:

- Preserve item meaning.
- Fix obvious speech recognition errors.
- Do not invent details not present in the original text.
- If uncertain, keep the original phrase and lower confidence.

Example:

Raw:

```text
我把可乐放在客厅臭屉
```

Corrected:

```text
我把可乐放在客厅抽屉
```

## Location Matching

During `/api/analyze`, backend sends active location paths and aliases to AI.

AI returns one of four statuses:

### matched

Use when there is one clear existing location.

```json
{
  "locationMatchStatus": "matched",
  "locationId": "loc_123",
  "location": "客厅 / 电视柜 / 左侧抽屉"
}
```

### needs_choice

Use when the text points to several plausible existing locations.

```json
{
  "locationMatchStatus": "needs_choice",
  "locationCandidates": [
    { "locationId": "loc_a", "path": "客厅 / 电视柜 / 左侧抽屉", "reason": "contains 客厅 and 抽屉" },
    { "locationId": "loc_b", "path": "客厅 / 茶几 / 抽屉", "reason": "contains 客厅 and 抽屉" }
  ]
}
```

### suggested_new

Use when a new location can be inferred from the text.

```json
{
  "locationMatchStatus": "suggested_new",
  "suggestedLocationPath": "书房 / 白色收纳盒",
  "suggestedParentPath": "书房"
}
```

The user can confirm this new location during save. Confirming creates the location and links the item to it.

### unclear

Use when the location is too vague.

```json
{
  "locationMatchStatus": "unclear",
  "location": "第三个抽屉",
  "reason": "room is missing"
}
```

The draft can still be saved, but it should be easy to correct in the admin UI later.

## Shortcut Confirmation Flow

Keep the iPhone flow simple.

After dictation, `/api/analyze` returns plain confirmation text suitable for display:

```text
原始语音：我把可乐放在客厅臭屉
修正后：我把可乐放在客厅抽屉
物品：可乐
建议位置：客厅 / 电视柜 / 左侧抽屉
```

If multiple choices exist, return candidates and a readable text block. V2 can support choosing by number:

```text
找到多个可能位置：
1. 客厅 / 电视柜 / 左侧抽屉
2. 客厅 / 茶几 / 抽屉
```

Confirmation API should support:

- Save matched location directly.
- Save with `selectedLocationId`.
- Save with `createSuggestedLocation=true`.
- Save unclear location as free text if the user chooses to proceed.

## API Changes

Add:

- `GET /api/locations`
- `POST /api/locations`
- `PATCH /api/locations/:id`
- `DELETE /api/locations/:id` as soft archive

Update:

- `POST /api/analyze`
  - Corrects dictation.
  - Includes active location paths in prompt context.
  - Creates draft with corrected text and location match metadata.
- `POST /api/confirm`
  - Accepts `selectedLocationId`.
  - Accepts `createSuggestedLocation`.
  - Saves `location_id`, free-text `location`, `corrected_text`, and location match status.
- `GET /api/confirm-text`
  - Keeps the body-free Shortcut path.
  - Can accept `selectedLocationId` and `createSuggestedLocation` as query parameters.

## Data Safety

Migration must preserve existing records.

Existing items have:

- `location_id = null`
- `corrected_text = raw_text`
- `location_match_status = "unclear"` or empty

## Testing

Add tests for:

- Location creation and hierarchy.
- Alias storage.
- Analyze includes active locations in AI context.
- Dictation correction fields are saved in drafts.
- Confirm saves matched `location_id`.
- Confirm can create suggested new location.
- Confirm can save with selected candidate location.
- Existing item records still list correctly after migration.

