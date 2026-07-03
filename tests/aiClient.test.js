import { describe, expect, it, vi } from 'vitest';
import { callJsonModel, parseJsonObject } from '../src/aiClient.js';

describe('AI client', () => {
  it('parses plain JSON objects', () => {
    expect(parseJsonObject('{"items":[{"displayName":"M3 screws"}]}')).toEqual({
      items: [{ displayName: 'M3 screws' }]
    });
  });

  it('parses fenced JSON objects', () => {
    expect(parseJsonObject('```json\n{"answer":"ok"}\n```')).toEqual({ answer: 'ok' });
  });

  it('calls an OpenAI-compatible chat completion endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"answer":"done"}' } }]
      })
    }));

    const result = await callJsonModel({
      config: {
        aiBaseUrl: 'https://api.example.com',
        aiApiKey: 'key',
        aiModel: 'cheap-model',
        aiTimeoutMs: 1000
      },
      messages: [{ role: 'user', content: 'hello' }],
      fetchImpl: fetchMock
    });

    expect(result).toEqual({ answer: 'done' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer key' })
      })
    );
  });
});
