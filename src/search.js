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
