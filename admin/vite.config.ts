import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// fs.allow: pricing and subscription rules are imported from ../web-prototype/src/lib, not copied.
export default defineConfig({ plugins: [react()], server: { port: 5174, fs: { allow: ['..'] } } });
