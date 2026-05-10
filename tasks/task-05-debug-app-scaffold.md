# Task 05: Scaffold packages/debug-app pnpm package

## Objective
Create the `packages/debug-app` pnpm package with its own Vite/React entry point, TypeScript config, and workspace wiring so `pnpm --filter @officexr/debug-app dev` starts the dev server.

## Context
- Read `tasks/shared-context.md` before starting.
- `pnpm-workspace.yaml` already contains `packages: ["packages/*"]` — the glob covers `packages/debug-app` automatically. No edit needed.
- Look at `packages/web/package.json` and `packages/web/vite.config.ts` for the existing Vite + React pattern in this repo.
- Use port **5174** to avoid conflicts with `packages/web` (which uses 5173).
- The package name is `@officexr/debug-app`.

**Quick Context:**
- This is a scaffolding-only task — no application logic. Application logic goes in Tasks 04, 06, 07, 08, 09.
- `src/main.tsx` should mount a placeholder `<App />` that renders `<h1>Debug App</h1>` — enough to verify the dev server works.

## Files to Create
- `packages/debug-app/package.json`
- `packages/debug-app/vite.config.ts`
- `packages/debug-app/tsconfig.json`
- `packages/debug-app/index.html`
- `packages/debug-app/src/main.tsx`
- `packages/debug-app/src/App.tsx` (placeholder)
- `packages/debug-app/vitest.config.ts`

## Requirements

### `package.json`
```json
{
  "name": "@officexr/debug-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@officexr/core-refactor": "workspace:*",
    "@officexr/sdk": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "three": "^0.170.0"
  },
  "devDependencies": {
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@types/three": "^0.170.0",
    "@vitejs/plugin-react": "^4",
    "typescript": "^5",
    "vite": "^6",
    "vitest": "^4.1.3"
  }
}
```
Match version ranges to what is already installed in the monorepo (`packages/web/package.json` is the reference). Exact versions are not critical — use compatible semver ranges.

### `vite.config.ts`
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
```

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

### `vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

### `index.html`
Standard Vite HTML template pointing to `src/main.tsx`:
```html
<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>OfficeXR Debug</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `src/main.tsx`
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
```

### `src/App.tsx` (placeholder — replaced in Task 06)
```tsx
export default function App() {
  return <h1>OfficeXR Debug</h1>;
}
```

## Acceptance Criteria
- [ ] `pnpm install` from the repo root resolves without errors after this task.
- [ ] `pnpm --filter @officexr/debug-app dev` starts a dev server on port 5174 and shows "OfficeXR Debug" in the browser.
- [ ] `pnpm --filter @officexr/debug-app typecheck` passes with no errors on the placeholder files.
- [ ] `pnpm --filter @officexr/debug-app test` passes (no test files yet; `passWithNoTests: true`).
- [ ] No files in `packages/core/`, `packages/web/`, or `packages/sdk/` are modified.

## Dependencies
- Depends on: None (can run in parallel with Tasks 01–03)
- Blocks: Task 04, Task 06, Task 07, Task 08, Task 09, Task 10
