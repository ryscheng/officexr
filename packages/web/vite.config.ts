import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// packages/core/src is one level up from packages/web
const coreRoot = path.resolve(__dirname, '../core/src');

export default defineConfig({
  assetsInclude: ['**/*.exr'],
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      // @/* resolves to packages/core/src — covers all web + shared imports.
      { find: '@', replacement: coreRoot },
    ],
  },
});
