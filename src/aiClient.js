export function parseJsonObject(text) {
  const cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('AI response did not contain a JSON object');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function callJsonModel({ config, messages, fetchImpl = fetch }) {
  if (!config.aiApiKey) {
    throw new Error('AI_API_KEY is required for AI calls');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs || 12000);
  try {
    const res = await fetchImpl(`${config.aiBaseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.aiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.aiModel,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`AI API failed with HTTP ${res.status}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || '';
    return parseJsonObject(content);
  } finally {
    clearTimeout(timeout);
  }
}
