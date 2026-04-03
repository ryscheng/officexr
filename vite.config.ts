import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const coreRoot = path.resolve(__dirname, 'packages/core/src');

export default defineConfig({
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
