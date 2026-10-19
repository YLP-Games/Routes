import dotenv from 'dotenv';
import { createApp } from './app';
import { createMockProvider } from './providers/mock';
import { createTomTomProvider } from './providers/tomtom';
import type { RoutingProvider } from './providers/types';

dotenv.config({ quiet: true });

const apiKey = process.env.TOMTOM_API_KEY?.trim();
let provider: RoutingProvider;
if (apiKey) {
  provider = createTomTomProvider({ apiKey });
} else {
  console.warn('[api] TOMTOM_API_KEY is not set: using the mock routing provider (demo estimates, no live traffic).');
  provider = createMockProvider();
}

const port = Number(process.env.PORT) || 8787;
createApp({ provider }).listen(port, () => {
  console.log(`[api] listening on http://localhost:${port} (provider: ${provider.name})`);
});
