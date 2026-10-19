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

const DEFAULT_API_PORT = 8787;

const asPort = (v: string | undefined): number | undefined => {
  const n = Number(v);
  return v && Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
};

/** Value of `--port <n>` or `--port=<n>` on the command line. */
function cliPort(argv: string[]): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') return asPort(argv[i + 1]);
    if (argv[i].startsWith('--port=')) return asPort(argv[i].slice('--port='.length));
  }
  return undefined;
}

// API_PORT wins, then --port. PORT is only a fallback for hosts that assign it (production):
// in dev, tools set PORT for the Vite server, so the dev scripts pass --port explicitly.
const port = asPort(process.env.API_PORT) ?? cliPort(process.argv.slice(2)) ?? asPort(process.env.PORT) ?? DEFAULT_API_PORT;
createApp({ provider }).listen(port, () => {
  console.log(`[api] listening on http://localhost:${port} (provider: ${provider.name})`);
});
