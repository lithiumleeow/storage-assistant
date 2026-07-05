import { describe, expect, it } from 'vitest';
import { buildAnalyzeMessages } from '../src/aiPrompts.js';

describe('AI prompts', () => {
  it('describes the three-level location model and common rooms', () => {
    const messages = buildAnalyzeMessages({
      text: '把螺丝放在货架第三层',
      similarItems: [],
      placementCandidates: [],
      locations: [{
        id: 'loc_shelf',
        path: '书房 / 货架',
        aliases: ['书房货架'],
        room: '书房',
        area: '货架',
        detail: '',
        level: 2
      }]
    });

    const payload = JSON.parse(messages[1].content);
    const systemText = messages[0].content;

    expect(systemText).toContain('three-level location model');
    expect(systemText).toContain('room is required');
    expect(systemText).toContain('infer the room');
    expect(payload.commonRooms).toEqual(['厨房', '客厅', '餐厅', '书房', '卧室', '阳台', '厕所', '洗手台', '玄关']);
    expect(payload.knownLocations[0]).toMatchObject({
      id: 'loc_shelf',
      path: '书房 / 货架',
      room: '书房',
      area: '货架',
      detail: '',
      level: 2
    });
  });
});
