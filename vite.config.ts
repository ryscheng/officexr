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
      // Web app source alias
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      // @officexr/core sub-path imports (explicit to satisfy TS strict alias typing)
      { find: '@officexr/core/types/avatar', replacement: path.join(coreRoot, 'types/avatar.ts') },
      { find: '@officexr/core/lib/supabase', replacement: path.join(coreRoot, 'lib/supabase.ts') },
      // Bare @officexr/core import (barrel)
      { find: '@officexr/core', replacement: path.join(coreRoot, 'index.ts') },
    ],
  },
});
