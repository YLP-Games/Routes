import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Same lookup as src/api/server.ts in dev: API_PORT (env or .env), else the dev scripts' --port 8787.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const apiPort = env.API_PORT || '8787';

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
  };
});
