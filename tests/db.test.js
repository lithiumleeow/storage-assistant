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
