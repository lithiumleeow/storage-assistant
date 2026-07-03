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
