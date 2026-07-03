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

  it('creates manual item records from admin input', async () => {
    const res = await authed(request(app).post('/api/items')).send({
      displayName: '备用钥匙',
      location: '玄关柜左边小盒子',
      tags: ['钥匙', '备用'],
      description: '家门备用钥匙'
    });

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('备用钥匙');
    expect(res.body.location).toBe('玄关柜左边小盒子');
    expect(res.body.tags).toEqual(['钥匙', '备用']);
  });

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
});
