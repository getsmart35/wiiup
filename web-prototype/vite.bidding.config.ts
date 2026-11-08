import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the trip bidding demo (bidding.html) on its own: `npx vite build --config vite.bidding.config.ts`
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist-bidding', rollupOptions: { input: 'bidding.html' } },
});
