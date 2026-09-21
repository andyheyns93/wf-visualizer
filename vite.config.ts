import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Standalone dev-harness build. The harness (the "graph" app) and the browser extension
// are two separate applications; each builds into its own subfolder of `dist/`.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/graph',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
