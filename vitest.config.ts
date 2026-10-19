import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'api',
          globals: true,
          environment: 'node',
          include: ['src/api/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          globals: true,
          environment: 'jsdom',
          include: ['src/components/**/*.test.tsx', 'src/*.test.tsx'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
    ],
  },
});
