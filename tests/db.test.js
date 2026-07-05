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
    expect(rows[0].correctedText).toBe('我把一包 M3 螺丝放在工具盒');
  });

  it('creates hierarchical locations with aliases', () => {
    const room = db.createLocation({ name: '客厅' });
    const cabinet = db.createLocation({ name: '电视柜', parentId: room.id });
    const drawer = db.createLocation({
      name: '左侧抽屉',
      parentId: cabinet.id,
      aliases: ['左抽', '客厅抽屉']
    });

    expect(drawer.id).toMatch(/^loc_/);
    expect(drawer.path).toBe('客厅 / 电视柜 / 左侧抽屉');
    expect(db.listLocations().map((location) => location.path)).toContain('客厅 / 电视柜 / 左侧抽屉');
    expect(db.getLocation(drawer.id).aliases).toEqual(['左抽', '客厅抽屉']);
  });

  it('creates missing segments from a full location path', () => {
    const finalLocation = db.createLocationPath('书房 / 白色收纳盒 / 第一层');

    expect(finalLocation.path).toBe('书房 / 白色收纳盒 / 第一层');
    expect(db.listLocations()).toHaveLength(3);
    expect(db.createLocationPath('书房 / 白色收纳盒 / 第一层').id).toBe(finalLocation.id);
  });

  it('stores structured location metadata on items', () => {
    const room = db.createLocation({ name: '客厅' });
    const drawer = db.createLocation({ name: '左侧抽屉', parentId: room.id, aliases: ['左抽'] });
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
