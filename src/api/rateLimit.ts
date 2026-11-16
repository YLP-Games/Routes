import type { RequestHandler } from 'express';
import { HttpError } from './errors';

export interface RateLimitOptions {
  /** Requests allowed per client per window. */
  limit: number;
  windowMs?: number;
  now?: () => number;
}

/** Above this many tracked clients, expired windows are swept so the map cannot grow without bound. */
const SWEEP_AT = 5_000;

/**
 * Fixed-window, per-client-IP request limit. It protects the metered routing and search quota from
 * a runaway client. Behind a reverse proxy, set TRUST_PROXY so req.ip is the real client address.
 */
export function rateLimit({ limit, windowMs = 60_000, now = Date.now }: RateLimitOptions): RequestHandler {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const t = now();
    const key = req.ip ?? 'unknown';
    let w = windows.get(key);
    if (!w || t >= w.resetAt) {
      if (windows.size >= SWEEP_AT) {
        for (const [k, v] of windows) if (t >= v.resetAt) windows.delete(k);
      }
      w = { count: 0, resetAt: t + windowMs };
      windows.set(key, w);
    }
    w.count++;
    if (w.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((w.resetAt - t) / 1000))));
      next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.'));
      return;
    }
    next();
  };
}
