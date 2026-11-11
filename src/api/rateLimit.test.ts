import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { HttpError } from './errors';
import { createMockProvider } from './providers/mock';
import { rateLimit } from './rateLimit';

const body = { points: [{ lat: -26.2041, lng: 28.0473 }, { lat: -25.7479, lng: 28.2293 }], customConsumptionL100km: 7, fuel: 'petrol95' };

describe('rateLimit', () => {
  it('allows the limit per window, then answers 429 with Retry-After until the window resets', async () => {
    let t = 1_000_000;
    const app = express();
    app.get('/x', rateLimit({ limit: 2, windowMs: 60_000, now: () => t }), (_req, res) => { res.json({ ok: true }); });
    app.use(((err, _req, res, _next) => {
      res.status((err as HttpError).status).json((err as HttpError).toBody());
    }) as express.ErrorRequestHandler);

    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(200);
    t += 20_000;
    const blocked = await request(app).get('/x');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('40');
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    t += 40_000;
    expect((await request(app).get('/x')).status).toBe(200);
  });
});

describe('API limits', () => {
  it('limits route calculations per client and leaves read-only endpoints alone', async () => {
    const app = createApp({ provider: createMockProvider(), rateLimitPerMinute: 2 });
    expect((await request(app).post('/api/route').send(body)).status).toBe(200);
    expect((await request(app).post('/api/route').send(body)).status).toBe(200);
    const blocked = await request(app).post('/api/route').send(body);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // Place search has its own, larger allowance; vehicles and prices are unlimited.
    for (let i = 0; i < 8; i++) expect((await request(app).get('/api/places').query({ q: 'durban' })).status).toBe(200);
    expect((await request(app).get('/api/places').query({ q: 'durban' })).status).toBe(429);
    expect((await request(app).get('/api/vehicles')).status).toBe(200);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('applies no limit unless one is configured', async () => {
    const app = createApp({ provider: createMockProvider() });
    for (let i = 0; i < 5; i++) expect((await request(app).post('/api/route').send(body)).status).toBe(200);
  });
});
