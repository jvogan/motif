import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  // The built-in vectors are imported into the self-contained bundle. Disable
  // Vite's URL-only public-directory handling so development and E2E resolve
  // that source import the same way as the production build.
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: 'dist-motif',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      input: 'motif.html',
    },
  },
});
