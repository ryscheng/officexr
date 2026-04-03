# OfficeXR — Agent & Developer Guide

## Project Overview

OfficeXR is a 3D virtual office platform with real-time presence, spatial audio, and avatar customization.
The codebase is organized as an **npm workspaces monorepo** targeting six platform builds:

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
├── src/                        # Web app source (React, Three.js, Tailwind)
│   ├── components/             # Three.js scene, avatars, settings, office selector
│   ├── hooks/                  # useAuth (Supabase session)
│   ├── lib/                    # Supabase client singleton (re-exports core)
│   ├── pages/                  # Home, Login
│   └── types/                  # avatar.ts re-exports from @officexr/core
├── packages/
│   ├── core/                   # @officexr/core — shared, platform-agnostic code
│   │   └── src/
│   │       ├── index.ts        # Barrel re-export
│   │       ├── lib/supabase.ts # Database types + createSupabaseClient factory
│   │       └── types/avatar.ts # AvatarCustomization, AvatarPreset, MARIO_PRESETS, etc.
│   ├── desktop/                # @officexr/desktop — Electron wrapper
│   │   └── src/
│   │       ├── main.ts         # Electron main process
│   │       └── preload.ts      # Context bridge (electronAPI)
│   └── mobile/                 # @officexr/mobile — React Native / Expo
│       └── src/
│           ├── App.tsx
│           ├── hooks/useAuth.ts
│           ├── lib/supabase.ts
│           ├── navigation/
│           └── screens/        # LoginScreen, HomeScreen, OfficeScreen
├── index.html                  # Web SPA entry point
├── vite.config.ts              # Web build config
├── tsconfig.json               # Web + workspace TypeScript config
├── supabase/migrations/        # SQL migrations
└── AGENTS.md                   # This file
```

---

## Shared Code Strategy

All platform-agnostic logic lives in **`packages/core`** and is the single source of truth.

| What | Where |
|------|-------|
| Database schema types (`Database`) | `packages/core/src/lib/supabase.ts` |
| Supabase client factory (`createSupabaseClient`) | `packages/core/src/lib/supabase.ts` |
| Avatar types & presets | `packages/core/src/types/avatar.ts` |

Platform packages import from `@officexr/core`. The web app's `src/types/avatar.ts` and
`src/lib/supabase.ts` are thin re-export wrappers around `@officexr/core` so existing
`@/types/avatar` and `@/lib/supabase` imports keep working without change.

The desktop package does **not** import from `@officexr/core` at runtime — it loads the
pre-built web dist in a WebView, so the web app's own code runs as-is.

The mobile package **does** import from `@officexr/core` for types and the Supabase factory,
while adding native auth (expo-auth-session) and native UI (React Navigation + StyleSheet).

---

## Default Build Target: Web

> **Always target the web build by default.** All commands below assume the web target
> unless a `:<platform>` suffix is specified.

```bash
npm run dev          # Start web dev server (Vite, http://localhost:5173)
npm run build        # Build web (outputs to dist/)
npm run preview      # Preview the production web build
```

---

## Building All Platforms

### Web (default)

```bash
npm run build          # or: npm run build:web
```

Output: `dist/`

### Desktop (Electron)

The desktop build wraps the web build. Always run `build:web` first or use the combined
scripts below:

```bash
npm run dist:desktop:mac    # macOS .dmg + .zip (universal)
npm run dist:desktop:win    # Windows .exe installer (x64 + arm64)
npm run dist:desktop:linux  # Linux .AppImage, .deb, .rpm (x64)
npm run dist:desktop:all    # All three platforms
```

Desktop development (loads from Vite dev server):
```bash
npm run dev                                  # terminal 1 — Vite
npm run build --workspace=packages/desktop   # compile main.ts
npx electron packages/desktop               # terminal 2 — Electron
```

### Mobile (React Native / Expo)

Prerequisites: [EAS CLI](https://docs.expo.dev/eas/) installed and logged in.

```bash
npm run dev:mobile             # Start Expo dev server (scan QR with Expo Go)
npm run build:mobile:ios       # EAS cloud build → .ipa
npm run build:mobile:android   # EAS cloud build → .aab / .apk
```

Local device runs (requires local Android/iOS toolchain):
```bash
npm run android --workspace=packages/mobile
npm run ios     --workspace=packages/mobile
```

---

## Environment Variables

### Web / Desktop (`.env` at repo root)

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Mobile (`packages/mobile/.env`)

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_WEB_APP_URL=https://your-officexr-deployment.vercel.app
```

Both files are gitignored. Copy from the corresponding `.env.example` files.

---

## Architecture Notes

### Desktop: Electron wraps the web build

- `packages/desktop/src/main.ts` registers a custom `app://` protocol that serves
  `dist/` files, falling back to `index.html` for any unknown path so React Router works.
- In development mode (`!app.isPackaged`) it loads from the Vite dev server at
  `http://localhost:5173` instead, enabling HMR.
- WebGL (Three.js) and experimental WebXR work in Electron's Chromium renderer.

### Mobile: WebView for the 3D scene

- Login, office list, and authentication are fully native (React Navigation, Supabase Auth
  with AsyncStorage persistence, Google OAuth via expo-auth-session).
- The 3D office scene (`OfficeScreen`) embeds the **deployed web build** in a
  `react-native-webview`. The Supabase session token is injected into `localStorage` so
  the web app recognises the already-authenticated user without a second login.
- This approach avoids reimplementing Three.js + WebXR in React Native for the initial
  release. The native-to-webview boundary means the mobile user gets the full 3D experience
  while login and navigation feel native.
- **Future:** Replace the WebView with `expo-gl` + `expo-three` for a fully native render
  path with deeper OS integration (AR via ARKit/ARCore).

### Supabase Realtime

All real-time features (presence, position sync, chat, proximity voice) are implemented
using Supabase Realtime channels in `src/components/OfficeScene.tsx` and shared equally
by web and desktop (same code). Mobile inherits this through the WebView.

### Proximity Voice Chat

When two users' bubble spheres (radius = 3 Three.js units) overlap, a shared Jitsi room
is auto-created and all nearby users join it. Cluster merges are handled by re-evaluating
room membership on every presence `sync` event.

---

## Adding New Shared Logic

1. Add to `packages/core/src/` (no framework dependencies allowed).
2. Re-export from `packages/core/src/index.ts`.
3. Import in mobile as `@officexr/core` (resolved by Babel's `module-resolver`).
4. Import in web as `@officexr/core` (resolved by Vite alias in `vite.config.ts`).

## Database Migrations

SQL migrations live in `supabase/migrations/`. Apply with:

```bash
supabase db push          # push all pending migrations
supabase db reset         # reset and re-apply from scratch (dev only)
```
