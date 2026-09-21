import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import manifest from './manifest.config';

// Build config for the browser extension (Chromium / Edge, MV3).
// Harness build stays in vite.config.ts; this one is selected via --config.
// The extension and the harness are separate apps built into sibling `dist/` subfolders.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true,
  },
});
