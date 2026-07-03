export function buildAnalyzeMessages({ text, similarItems, placementCandidates }) {
  return [
    {
      role: 'system',
      content: [
        'You are a household storage assistant.',
        'Return strict JSON only.',
        'Do not invent precise product names when the user is uncertain.',
        'Use practical broad categories and search-friendly tags.',
        'If the user states a location, preserve it.'
      ].join(' ')
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Analyze storage voice input into item records.',
        inputText: text,
        similarItems,
        placementCandidates,
        outputShape: {
          items: [
            {
              displayName: 'string',
              description: 'string',
              category: 'string',
              tags: ['string'],
              useContext: 'string',
              relatedItems: ['string'],
              location: 'string',
              zone: 'string',
              placementReason: 'string',
              confidence: 0.8
            }
          ],
          summary: 'Chinese summary for review'
        }
      })
    }
  ];
}

export function buildSearchSummaryMessages({ query, matches }) {
  return [
    { role: 'system', content: 'You summarize household storage search results in concise Chinese. Return strict JSON only.' },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Answer where the requested objects might be.',
        query,
        matches,
        outputShape: { answer: 'string', matches: [{ id: 'string', displayName: 'string', location: 'string', whyMatched: 'string' }] }
      })
    }
  ];
}

export function buildRecommendationMessages({ text, candidates }) {
  return [
    { role: 'system', content: 'You recommend household storage locations based on history. Return strict JSON only.' },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Recommend where to place this object.',
        inputText: text,
        candidates,
        rules: [
          'Keep screws and small hardware together.',
          'Keep similar products in the same area.',
          'Keep co-used items near each other.',
          'If no history exists, say this is a first-time recommendation.'
        ],
        outputShape: { recommendedLocation: 'string', reason: 'string', relatedRecords: [] }
      })
    }
  ];
}
