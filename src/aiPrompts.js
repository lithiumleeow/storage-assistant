export function buildAnalyzeMessages({ text, similarItems, placementCandidates, locations = [] }) {
  return [
    {
      role: 'system',
      content: [
        'You are a household storage assistant.',
        'Return strict JSON only.',
        'First correct obvious speech recognition mistakes, then analyze the corrected text.',
        'Do not invent precise product names when the user is uncertain.',
        'Use practical broad categories and search-friendly tags.',
        'If the user states a location, preserve it.',
        'Match locations only against provided active location IDs.',
        'Use needs_choice when multiple known locations are plausible.',
        'Use suggested_new only when the user said enough location detail to create a useful path.',
        'If uncertain, keep the original phrase and lower confidence.'
      ].join(' ')
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Correct dictation, analyze storage voice input into item records, and match storage location.',
        inputText: text,
        knownLocations: locations.map(({ id, path, aliases }) => ({ id, path, aliases })),
        similarItems,
        placementCandidates,
        outputShape: {
          rawText: 'string',
          correctedText: 'string',
          correctionReason: 'string',
          locationMatchStatus: 'matched | needs_choice | suggested_new | unclear',
          locationId: 'string or null',
          location: 'string',
          locationCandidates: [{ locationId: 'string', path: 'string', reason: 'string' }],
          suggestedLocationPath: 'string',
          suggestedParentPath: 'string',
          items: [
            {
              displayName: 'string',
              rawText: 'string',
              correctedText: 'string',
              description: 'string',
              category: 'string',
              tags: ['string'],
              useContext: 'string',
              relatedItems: ['string'],
              location: 'string',
              locationId: 'string or null',
              locationMatchStatus: 'matched | needs_choice | suggested_new | unclear',
              locationCandidates: [{ locationId: 'string', path: 'string', reason: 'string' }],
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
