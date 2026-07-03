import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';

describe('basic app', () => {
  it('responds to health checks', async () => {
    const app = createApp({ config: { version: 'test' } });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns the configured version marker', async () => {
    const app = createApp({ config: { version: 'test-version' } });
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: 'test-version' });
  });
});
