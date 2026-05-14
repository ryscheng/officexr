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
│   │       ├── assets/
│   │       │   └── hdri/       # HDRI environment maps (EXR) — global lobby skybox
│   │       ├── components/
│   │       │   ├── Avatar.tsx
│   │       │   ├── ControlsOverlay.tsx  # Shared controls UI (motion, recalibrate)
│   │       │   ├── OfficeSelector.tsx
│   │       │   ├── RoomScene.tsx        # Three.js WebXR scene + Realtime presence
│   │       │   ├── SettingsPanel.tsx
│   │       │   └── UserLobby.tsx        # Authenticated user lobby with room portals
│   │       ├── hooks/
│   │       │   ├── useAuth.ts           # Supabase session
│   │       │   └── useMotionControls.ts # Gyroscope / device-orientation look controls
│   │       ├── lib/
│   │       │   ├── jaasJwt.ts  # JaaS JWT generation (Web Crypto, RS256)
│   │       │   └── supabase.ts # Database type + Supabase web client singleton
│   │       ├── pages/
│   │       │   ├── Home.tsx     # Route "/" — lobby or room depending on auth state
│   │       │   ├── Login.tsx    # Route "/login"
│   │       │   └── RoomPage.tsx # Route "/room/:id" — deep-link into a specific room
│   │       └── types/
│   │           └── avatar.ts   # AvatarCustomization, AvatarPreset, MARIO_PRESETS, etc.
│   ├── web/                    # @officexr/web — Vite build wrapper for the browser
│   │   ├── index.html          # SPA shell (entry: ../core/src/main.tsx)
│   │   ├── vite.config.ts      # @ alias → ../core/src; assetsInclude EXR
│   │   ├── tsconfig.json
│   │   ├── tsconfig.node.json
│   │   ├── public/             # Static assets (SVGs etc.)
│   │   └── .env.example        # VITE_SUPABASE_*, VITE_JAAS_*
│   ├── desktop/                # @officexr/desktop — Electron wrapper
│   │   └── src/
│   │       ├── main.ts         # Electron main process
│   │       └── preload.ts      # Context bridge (electronAPI)
│   └── mobile/                 # @officexr/mobile — React Native / Expo
│       └── src/
│           ├── App.tsx
│           ├── index.ts
│           ├── hooks/useAuth.ts
│           ├── lib/supabase.ts  # Native Supabase client (AsyncStorage)
│           ├── navigation/
│           └── screens/        # LoginScreen, HomeScreen, OfficeScreen
├── supabase/migrations/        # SQL migrations
├── .github/workflows/
│   └── supabase-migrations.yml # Applies migrations on push to main + workflow_dispatch
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

## Studio Editors (5 modes)

The studio (`@officexr/studio`) at `pnpm --filter @officexr/studio dev` is
restructured into five purpose-built modes, each a separate App under
`packages/studio/src/modes/<name>/`:

| Mode      | Hash      | Purpose                                                  |
|-----------|-----------|----------------------------------------------------------|
| Map       | `#map`    | Compose Rooms into a world — placement, rotation, spawn points, environment (sun/sky/stars/HDRI) |
| Room      | `#room`   | Author a single Room: Select / Add / Delete / Tile tools, multi-select + groups, point-and-click cube placement |
| Object    | `#object` | Tune every cube kind: label, swatch, walkable, scale, tint, opacity, roughness, metalness, emissive |
| Character | `#character` | Character previewer + per-model tuning                |
| Debug     | `#debug`  | Playtest: pick a map, bots spawn at the map's spawn points, Reset & respawn warps everyone |

Storage endpoints (Vite middleware):
- `/api/rooms/:name` — RoomDocument JSON
- `/api/maps/:name` — MapDocumentV1 JSON
- `/api/cube-kinds` — single-doc catalog GET/PUT

Files on disk:
- `packages/world/rooms/*.json`
- `packages/world/maps/*.json` (`default.json` is the seed)
- `packages/world/cube-kinds.json` (+ `cube-kinds.default.json` fallback)

### Studio control kit

Every panel uses an in-house control kit at
`packages/studio/src/ui/controls/` built on shadcn-style wrappers
around Radix primitives (slider, select, switch, collapsible, popover,
tooltip, label) plus `react-colorful` for color pickers. The base
shadcn components live at `packages/studio/src/components/ui/`.
Styling is Tailwind v4 (configured via `@tailwindcss/vite`); tokens
match the dark studio palette and are declared in
`packages/studio/src/styles/globals.css`.

Key controls:
- `<NumberInput>` — slider + draggable scrubber + click-to-type
  (drag-to-scrub uses `useDragScrub`; shift = ×10, alt = ×0.1).
- `<ColorInput>` — `react-colorful` HexColorPicker in a Popover.
- `<Vector3Input>` — three scrubbers side-by-side.
- `<NullableField>` — checkbox + slotted control for `tint`/
  `roughness`/`metalness`/`emissive` "use X" pairs.
- `<Section>` — Radix Collapsible with an optional enable-toggle.

Every value is fully controlled — there is no module-level store
backing any of the panels. The previous Leva-based stack has been
removed entirely; `pnpm --filter @officexr/studio lint:leva-free`
runs four greps and fails CI if any Leva references leak back in.

The world renderer's 8 dev-tweaker panels (Bot, Animation,
Proximity, Lighting, Background, FixedCamera, World, Settings) live
at `packages/studio/src/panels/world/`. They edit a `ViewConfig`
bag persisted to `localStorage` via `useStudioSettings`; Debug Mode
passes the bag into `<Scene>` as a `viewConfig` prop so the
renderer stays UI-free.

## Studio Asset Packs

The studio's Object editor + Room editor catalog references three KayKit FREE
packs (Furniture, Prototype, Restaurant) hosted on Cloudflare R2. The `.gltf`
binaries are gitignored — the matching catalog entries in
`packages/world/cube-kinds.json` ARE committed. After cloning, populate the
binaries locally:

```bash
pnpm asset-packs:install        # idempotent; add --force to redownload
```

This downloads the three zip files, unzips them into
`packages/studio/public/models/{furniture,prototype,restaurant}/`, enumerates
the `.gltf` files, and appends any not-yet-known entries to
`cube-kinds.json`. Re-running with no new packs is a no-op.

If you skip the install step, the catalog still loads but
`useGLTF(...)` will 404 on any furniture / prototype / restaurant kind your
scene references. The original 12 KayKit BlockBits ship in-repo so the
default Scenes / Debug paths work without the install step.

## Database Migrations

SQL migrations live in `supabase/migrations/`. Apply with:

```bash
supabase db push          # push all pending migrations
supabase db reset         # reset and re-apply from scratch (dev only)
```
