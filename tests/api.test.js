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
      rawText: '螺丝放在工具盒',
      correctedText: '螺丝放在工具盒',
      correctionReason: '',
      locationMatchStatus: 'unclear',
      locationId: null,
      locationCandidates: [],
      suggestedLocationPath: '',
      items: [{
        displayName: 'M3 screws',
        rawText: '螺丝放在工具盒',
        correctedText: '螺丝放在工具盒',
        description: 'A pack of M3 screws',
        category: 'hardware',
        tags: ['螺丝', 'M3'],
        useContext: 'repair',
        relatedItems: ['垫片'],
        location: '工具盒',
        locationId: null,
        locationMatchStatus: 'unclear',
        locationCandidates: [],
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
    expect(res.body.correctedText).toBe('螺丝放在工具盒');
    expect(res.body.locationMatchStatus).toBe('unclear');
    expect(res.body.items[0].displayName).toBe('M3 screws');
  });

  it('passes active locations to AI analysis', async () => {
    const room = db.createLocation({ name: '客厅' });
    db.createLocation({ name: '左侧抽屉', parentId: room.id, aliases: ['客厅抽屉'] });

    const res = await authed(request(app).post('/api/analyze')).send({ text: '我把可乐放在客厅臭屉' });

    expect(res.status).toBe(200);
    expect(ai.analyze).toHaveBeenCalledWith(expect.objectContaining({
      text: '我把可乐放在客厅臭屉',
      locations: expect.arrayContaining([
        expect.objectContaining({ path: '客厅 / 左侧抽屉', aliases: ['客厅抽屉'] })
      ])
    }));
  });

  it('confirms a draft into item records', async () => {
    const draft = await authed(request(app).post('/api/analyze')).send({ text: '螺丝放在工具盒' });
    const res = await authed(request(app).post('/api/confirm')).send({ draftId: draft.body.draftId });
    expect(res.status).toBe(200);
    expect(res.body.savedCount).toBe(1);
    expect(db.listItems({})[0].displayName).toBe('M3 screws');
  });

  it('confirms a draft when iPhone Shortcuts sends draftId as plain text', async () => {
    const draft = await authed(request(app).post('/api/analyze')).send({ text: '螺丝放在工具盒' });
    const res = await authed(request(app).post('/api/confirm'))
      .set('Content-Type', 'text/plain')
      .send(draft.body.draftId);

    expect(res.status).toBe(200);
    expect(res.body.savedCount).toBe(1);
    expect(db.listItems({})[0].location).toBe('工具盒');
  });

  it('confirms a draft when iPhone Shortcuts sends JSON text as text/plain', async () => {
    const draft = await authed(request(app).post('/api/analyze')).send({ text: '螺丝放在工具盒' });
    const res = await authed(request(app).post('/api/confirm'))
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ draftId: draft.body.draftId }));

    expect(res.status).toBe(200);
    expect(res.body.savedCount).toBe(1);
    expect(db.listItems({})[0].displayName).toBe('M3 screws');
  });

  it('returns plain text for shortcut confirmation', async () => {
    const draft = await authed(request(app).post('/api/analyze')).send({ text: '螺丝放在工具盒' });
    const res = await authed(request(app).post('/api/confirm-text'))
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ draftId: draft.body.draftId }));

    expect(res.status).toBe(200);
    expect(res.text).toContain('已保存 1 条');
    expect(res.text).toContain('M3 screws');
    expect(db.listItems({})[0].displayName).toBe('M3 screws');
  });

  it('confirms a draft through query string for body-free shortcuts', async () => {
    const draft = await authed(request(app).post('/api/analyze')).send({ text: '螺丝放在工具盒' });
    const res = await authed(request(app).get(`/api/confirm-text?draftId=${encodeURIComponent(draft.body.draftId)}`));

    expect(res.status).toBe(200);
    expect(res.text).toContain('已保存 1 条');
    expect(db.listItems({})[0].displayName).toBe('M3 screws');
  });

  it('returns a plain text error when shortcut confirmation fails', async () => {
    const res = await authed(request(app).post('/api/confirm-text'))
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ draftId: 'draft_missing' }));

    expect(res.status).toBe(404);
    expect(res.text).toContain('保存失败');
  });

  it('normalizes snake_case AI item fields during confirmation', async () => {
    const draft = db.createDraft({
      rawText: '备用钥匙放在玄关盒子',
      analysis: {
        items: [{
          display_name: '备用钥匙',
          raw_text: '备用钥匙放在玄关盒子',
          category: 'keys',
          tags: ['钥匙'],
          use_context: '开门备用',
          related_items: ['门锁'],
          location: '玄关盒子',
          placement_reason: '钥匙集中放置',
          confidence: 0.8
        }]
      },
      recommendation: {}
    });

    const res = await authed(request(app).post('/api/confirm')).send({ draftId: draft.id });

    expect(res.status).toBe(200);
    expect(db.listItems({})[0].displayName).toBe('备用钥匙');
    expect(db.listItems({})[0].useContext).toBe('开门备用');
  });

  it('manages location records through the API', async () => {
    const room = await authed(request(app).post('/api/locations')).send({ name: '客厅' });
    const drawer = await authed(request(app).post('/api/locations')).send({
      name: '左侧抽屉',
      parentId: room.body.id,
      aliases: ['左抽']
    });
    const patched = await authed(request(app).patch(`/api/locations/${drawer.body.id}`)).send({
      aliases: ['左抽', '客厅抽屉']
    });
    const list = await authed(request(app).get('/api/locations'));

    expect(room.status).toBe(200);
    expect(drawer.body.path).toBe('客厅 / 左侧抽屉');
    expect(patched.body.aliases).toEqual(['左抽', '客厅抽屉']);
    expect(list.body.locations.map((location) => location.path)).toContain('客厅 / 左侧抽屉');

    const deleted = await authed(request(app).delete(`/api/locations/${drawer.body.id}`));
    const activeList = await authed(request(app).get('/api/locations'));

    expect(deleted.status).toBe(200);
    expect(activeList.body.locations.map((location) => location.id)).not.toContain(drawer.body.id);
  });

  it('creates three-level locations from room area and detail fields', async () => {
    const res = await authed(request(app).post('/api/locations')).send({
      room: '书房',
      area: '货架',
      detail: '第三层',
      aliases: ['书房货架三层']
    });

    expect(res.status).toBe(200);
    expect(res.body.path).toBe('书房 / 货架 / 第三层');
    expect(res.body.room).toBe('书房');
    expect(res.body.area).toBe('货架');
    expect(res.body.detail).toBe('第三层');
    expect(db.getLocationByPath('书房 / 货架 / 第三层').aliases).toEqual(['书房货架三层']);
  });

  it('requires a room when creating a structured location', async () => {
    const res = await authed(request(app).post('/api/locations')).send({
      area: '货架',
      detail: '第三层'
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('room is required');
  });

  it('confirms a matched draft with structured location metadata', async () => {
    const room = db.createLocation({ name: '客厅' });
    const drawer = db.createLocation({ name: '左侧抽屉', parentId: room.id });
    const draft = db.createDraft({
      rawText: '我把可乐放在客厅臭屉',
      analysis: {
        correctedText: '我把可乐放在客厅抽屉',
        locationMatchStatus: 'matched',
        locationId: drawer.id,
        locationCandidates: [],
        items: [{ displayName: '可乐', location: drawer.path, confidence: 0.9 }]
      },
      recommendation: {}
    });

    const res = await authed(request(app).post('/api/confirm')).send({ draftId: draft.id });

    expect(res.status).toBe(200);
    expect(db.listItems({})[0].locationId).toBe(drawer.id);
    expect(db.listItems({})[0].location).toBe('客厅 / 左侧抽屉');
    expect(db.listItems({})[0].correctedText).toBe('我把可乐放在客厅抽屉');
    expect(db.listItems({})[0].locationMatchStatus).toBe('matched');
  });

  it('confirms a draft with a selected candidate location through query string', async () => {
    const room = db.createLocation({ name: '客厅' });
    const leftDrawer = db.createLocation({ name: '左侧抽屉', parentId: room.id });
    const rightDrawer = db.createLocation({ name: '右侧抽屉', parentId: room.id });
    const draft = db.createDraft({
      rawText: '我把遥控器放在客厅抽屉',
      analysis: {
        correctedText: '我把遥控器放在客厅抽屉',
        locationMatchStatus: 'needs_choice',
        locationCandidates: [
          { locationId: leftDrawer.id, path: leftDrawer.path, reason: '同在客厅抽屉' },
          { locationId: rightDrawer.id, path: rightDrawer.path, reason: '同在客厅抽屉' }
        ],
        items: [{ displayName: '遥控器', location: '客厅抽屉', confidence: 0.7 }]
      },
      recommendation: {}
    });

    const res = await authed(request(app).get(`/api/confirm-text?draftId=${draft.id}&selectedLocationId=${rightDrawer.id}`));

    expect(res.status).toBe(200);
    expect(res.text).toContain('位置：客厅 / 右侧抽屉');
    expect(db.listItems({})[0].locationId).toBe(rightDrawer.id);
  });

  it('confirms a selected candidate when shortcut sends JSON as text/plain', async () => {
    const room = db.createLocation({ name: '书房' });
    const drawer = db.createLocation({ name: '桌下抽屉', parentId: room.id });
    const draft = db.createDraft({
      rawText: '我把读卡器放在书房抽屉',
      analysis: {
        correctedText: '我把读卡器放在书房抽屉',
        locationMatchStatus: 'needs_choice',
        locationCandidates: [{ locationId: drawer.id, path: drawer.path, reason: '书房抽屉' }],
        items: [{ displayName: '读卡器', location: '书房抽屉', confidence: 0.7 }]
      },
      recommendation: {}
    });

    const res = await authed(request(app).post('/api/confirm-text'))
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ draftId: draft.id, selectedLocationId: drawer.id }));

    expect(res.status).toBe(200);
    expect(db.listItems({})[0].locationId).toBe(drawer.id);
  });

  it('confirms a draft and creates an AI suggested new location', async () => {
    const draft = db.createDraft({
      rawText: '我把胶带放在书房白色收纳盒',
      analysis: {
        correctedText: '我把胶带放在书房白色收纳盒',
        locationMatchStatus: 'suggested_new',
        suggestedLocationPath: '书房 / 白色收纳盒',
        items: [{ displayName: '胶带', location: '书房白色收纳盒', confidence: 0.8 }]
      },
      recommendation: {}
    });

    const res = await authed(request(app).get(`/api/confirm-text?draftId=${draft.id}&createSuggestedLocation=true`));

    expect(res.status).toBe(200);
    expect(db.getLocationByPath('书房 / 白色收纳盒').path).toBe('书房 / 白色收纳盒');
    expect(db.listItems({})[0].location).toBe('书房 / 白色收纳盒');
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
