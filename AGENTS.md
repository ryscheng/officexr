# OfficeXR — Agent & Developer Guide

## Project Overview

OfficeXR is a 3D virtual office platform with real-time presence, spatial audio, and avatar customization.
The codebase is organized as a **pnpm workspaces monorepo** targeting six platform builds:

> **Package manager: pnpm.** Always use `pnpm` — do not use `npm` or `yarn`.
> Workspace config lives in `pnpm-workspace.yaml`; cross-package deps use the `workspace:*` protocol.

| Build | Target | Toolchain |
|-------|--------|-----------|
| Web | Browser | Vite + React |
| Desktop (macOS) | macOS app | Electron + electron-builder |
| Desktop (Windows) | Windows app | Electron + electron-builder |
| Desktop (Linux) | Linux app | Electron + electron-builder |
| Mobile (iOS) | iOS app | Expo + EAS Build |
| Mobile (Android) | Android app | Expo + EAS Build |

---

## Repository Structure

```
officexr/
├── packages/
│   ├── core/                   # @officexr/core — all application source + shared types
│   │   └── src/
│   │       ├── index.ts        # Barrel: platform-agnostic type exports (Database, avatars)
│   │       ├── main.tsx        # Web entry point
│   │       ├── App.tsx
│   │       ├── index.css
│   │       ├── vite-env.d.ts
│   │       ├── components/     # Avatar, RoomScene, OfficeSelector, SettingsPanel
│   │       ├── hooks/          # useAuth (Supabase session)
│   │       ├── lib/
│   │       │   └── supabase.ts # Database type + Supabase web client singleton
│   │       ├── pages/          # Home, Login
│   │       └── types/
│   │           └── avatar.ts   # AvatarCustomization, AvatarPreset, MARIO_PRESETS, etc.
│   ├── web/                    # @officexr/web — Vite build wrapper for the browser
│   │   ├── index.html          # SPA shell (entry: ../core/src/main.tsx)
│   │   ├── vite.config.ts      # @ alias → ../core/src
│   │   ├── tsconfig.json
│   │   ├── tsconfig.node.json
│   │   ├── public/             # Static assets
│   │   └── .env.example        # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
│   ├── desktop/                # @officexr/desktop — Electron wrapper
│   │   └── src/
│   │       ├── main.ts         # Electron main process
│   │       └── preload.ts      # Context bridge (electronAPI)
│   └── mobile/                 # @officexr/mobile — React Native / Expo
│       └── src/
│           ├── App.tsx
│           ├── hooks/useAuth.ts
│           ├── lib/supabase.ts  # Native Supabase client (AsyncStorage)
│           ├── navigation/
│           └── screens/        # LoginScreen, HomeScreen, OfficeScreen
├── supabase/migrations/        # SQL migrations
├── pnpm-workspace.yaml         # Workspace package globs
├── tsconfig.json               # Root: IDE project references only
└── AGENTS.md                   # This file
```

---

## Shared Code Strategy

All application source lives in **`packages/core/src`**. The web build (`packages/web`) is
a thin Vite wrapper that points its entry and `@` alias at `packages/core/src` — it adds
no application logic of its own.

| What | Where |
|------|-------|
| Database schema types (`Database`) | `packages/core/src/lib/supabase.ts` |
| Supabase web client singleton | `packages/core/src/lib/supabase.ts` |
| Avatar types & presets | `packages/core/src/types/avatar.ts` |
| React components, pages, hooks | `packages/core/src/` |

The `packages/core/src/index.ts` barrel exports **only** platform-agnostic types
(`Database`, avatar interfaces/constants) so mobile packages that import
`@officexr/core` never encounter `import.meta.env` at runtime.

The desktop package loads the pre-built web dist via a custom `app://` protocol; it does
not import from `@officexr/core` directly.

The mobile package imports the `Database` type and avatar types from `@officexr/core`
(resolved by Babel's `module-resolver`), while providing its own Supabase client
(AsyncStorage-backed) and native UI (React Navigation).

---

## Default Build Target: Web

> **Always target the web build by default.** All commands below assume the web target
> unless a `:<platform>` suffix is specified.

```bash
pnpm dev          # Start web dev server (Vite, http://localhost:5173)
pnpm build        # Build web (outputs to packages/web/dist/)
pnpm preview      # Preview the production web build
```

---

## Building All Platforms

### Web (default)

```bash
pnpm build          # or: pnpm build:web
```

Output: `packages/web/dist/`

To work directly inside the package:
```bash
cd packages/web
pnpm dev
pnpm build
```

### Desktop (Electron)

The desktop build wraps the web build. Always run `build:web` first or use the combined
scripts below:

```bash
pnpm dist:desktop:mac    # macOS .dmg + .zip (universal)
pnpm dist:desktop:win    # Windows .exe installer (x64 + arm64)
pnpm dist:desktop:linux  # Linux .AppImage, .deb, .rpm (x64)
pnpm dist:desktop:all    # All three platforms
```

Desktop development (loads from Vite dev server):
```bash
pnpm dev                                           # terminal 1 — Vite
pnpm --filter @officexr/desktop run build          # compile main.ts
pnpm --filter @officexr/desktop exec electron .    # terminal 2 — Electron
```

### Mobile (React Native / Expo)

Prerequisites: [EAS CLI](https://docs.expo.dev/eas/) installed and logged in.

```bash
pnpm dev:mobile             # Start Expo dev server (scan QR with Expo Go)
pnpm build:mobile:ios       # EAS cloud build → .ipa
pnpm build:mobile:android   # EAS cloud build → .aab / .apk
```

Local device runs (requires local Android/iOS toolchain):
```bash
pnpm --filter @officexr/mobile run android
pnpm --filter @officexr/mobile run ios
```

---

## Environment Variables

### Web (`packages/web/.env`)

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Copy from `packages/web/.env.example`. Vite loads `.env` from `packages/web/` when
`pnpm dev` / `pnpm build` are run inside that package.

### Mobile (`packages/mobile/.env`)

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
EXPO_PUBLIC_WEB_APP_URL=https://your-officexr-deployment.vercel.app
```

Copy from `packages/mobile/.env.example`.

---

## Architecture Notes

### Desktop: Electron wraps the web build

- `packages/desktop/src/main.ts` registers a custom `app://` protocol that serves
  `packages/web/dist/` files, falling back to `index.html` for any unknown path so
  React Router works.
- In development mode (`!app.isPackaged`) it loads from the Vite dev server at
  `http://localhost:5173` instead, enabling HMR.
- WebGL (Three.js) and experimental WebXR work in Electron's Chromium renderer.

### Mobile: WebView for the 3D scene

- Login, office list, and authentication are fully native (React Navigation, Supabase Auth
  with AsyncStorage persistence, Google OAuth via expo-auth-session).
- The 3D office scene (`OfficeScreen`) embeds the **deployed web build** in a
  `react-native-webview`. The Supabase session token is injected into `localStorage` so
  the web app recognises the already-authenticated user without a second login.
- **Future:** Replace the WebView with `expo-gl` + `expo-three` for a fully native render
  path with deeper OS integration (AR via ARKit/ARCore).

### Supabase Realtime

All real-time features (presence, position sync, chat, proximity voice) are implemented
using Supabase Realtime channels in `packages/core/src/components/RoomScene.tsx` and
shared equally by web and desktop (same code). Mobile inherits this through the WebView.

### Proximity Voice Chat

When two users' bubble spheres (radius = 3 Three.js units) overlap, a shared Jitsi room
is auto-created and all nearby users join it. Cluster merges are handled by re-evaluating
room membership on every presence `sync` event.

---

## Adding New Shared Logic

1. Add to `packages/core/src/` (keep framework deps out of `lib/` and `types/` if possible).
2. If platform-agnostic, re-export from `packages/core/src/index.ts`.
3. Import in mobile as `@officexr/core` (resolved by Babel's `module-resolver`).
4. Import in web using the `@/` alias (resolved by Vite to `packages/core/src`).

## Database Migrations

SQL migrations live in `supabase/migrations/`. Apply with:

```bash
supabase db push          # push all pending migrations
supabase db reset         # reset and re-apply from scratch (dev only)
```
