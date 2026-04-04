# OfficeXR

A 3D virtual office platform with real-time presence, spatial audio, and avatar customization. Navigate immersive rooms in your browser, desktop app, or VR headset.

## Features

- **Google Authentication** — Supabase Auth with Google OAuth
- **Real-time Presence** — See other users move around in 3D via Supabase Realtime
- **3D Avatars** — Customizable avatars with name labels
- **Proximity Voice Chat** — Jitsi-powered spatial audio that activates when users are near each other
- **Multiple Environments** — Corporate office, cabin, and coffee shop scenes
- **HDRI Skybox** — Photorealistic outdoor panorama for the global lobby
- **WebXR Support** — Full VR support for compatible headsets
- **Desktop App** — Electron wrapper for macOS, Windows, and Linux
- **Mobile App** — Expo/React Native app for iOS and Android

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web framework | Vite + React 19 |
| 3D rendering | Three.js + WebXR |
| Auth & database | Supabase (PostgreSQL + Realtime) |
| Voice chat | Jitsi as a Service (JaaS) |
| Desktop | Electron + electron-builder |
| Mobile | Expo (React Native) + EAS Build |
| Package manager | pnpm workspaces |

## Project Structure

```
officexr/
├── packages/
│   ├── core/                   # @officexr/core — shared application source
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── main.tsx        # Web entry point
│   │       ├── index.ts        # Barrel: platform-agnostic type exports
│   │       ├── index.css
│   │       ├── vite-env.d.ts
│   │       ├── assets/
│   │       │   └── hdri/       # HDRI environment maps (EXR)
│   │       ├── components/
│   │       │   ├── Avatar.tsx
│   │       │   ├── ControlsOverlay.tsx
│   │       │   ├── OfficeSelector.tsx
│   │       │   ├── RoomScene.tsx
│   │       │   ├── SettingsPanel.tsx
│   │       │   └── UserLobby.tsx
│   │       ├── hooks/
│   │       │   ├── useAuth.ts
│   │       │   └── useMotionControls.ts
│   │       ├── lib/
│   │       │   ├── jaasJwt.ts  # JaaS JWT generation (Web Crypto, RS256)
│   │       │   └── supabase.ts # Supabase client + Database types
│   │       ├── pages/
│   │       │   ├── Home.tsx
│   │       │   ├── Login.tsx
│   │       │   └── RoomPage.tsx
│   │       └── types/
│   │           └── avatar.ts
│   ├── web/                    # @officexr/web — Vite browser build
│   │   ├── index.html
│   │   ├── vite.config.ts      # @ alias → ../core/src
│   │   ├── public/             # Static assets
│   │   └── .env.example
│   ├── desktop/                # @officexr/desktop — Electron wrapper
│   │   └── src/
│   │       ├── main.ts
│   │       └── preload.ts
│   └── mobile/                 # @officexr/mobile — React Native / Expo
│       └── src/
│           ├── App.tsx
│           ├── index.ts
│           ├── hooks/useAuth.ts
│           ├── lib/supabase.ts
│           ├── navigation/
│           └── screens/
│               ├── HomeScreen.tsx
│               ├── LoginScreen.tsx
│               └── OfficeScreen.tsx
├── supabase/migrations/        # SQL migrations (applied via Supabase CLI)
├── .github/workflows/
│   └── supabase-migrations.yml # Auto-applies migrations on push to main
├── pnpm-workspace.yaml
└── package.json                # Root scripts
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- A [Supabase](https://supabase.com) project
- A [JaaS](https://jaas.8x8.vc) account (for proximity voice chat)

### Installation

```bash
pnpm install
```

### Environment Variables

Copy and fill in `packages/web/.env.example`:

```bash
cp packages/web/.env.example packages/web/.env
```

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
VITE_JAAS_APP_ID=your-jaas-app-id
VITE_JAAS_API_KEY_ID=your-jaas-api-key-id
VITE_JAAS_PRIVATE_KEY=your-jaas-private-key-base64
```

### Database

Apply migrations to your Supabase project:

```bash
supabase link --project-ref <your-project-id>
supabase db push
```

### Run

```bash
pnpm dev        # Web dev server at http://localhost:5173
```

## Controls

### Desktop (keyboard + mouse)

- **W / A / S / D** or **Arrow Keys** — Move
- **Click** — Capture mouse for look-around (pointer lock)
- **Mouse drag** — Look around (after clicking)
- **Esc** — Release mouse

### Mobile

- **Drag** — Look around
- **Virtual joystick** — Move
- **Gyroscope** — Look around by tilting your device (iOS requires permission)

### VR (WebXR)

- Click **Enter VR** in the controls panel
- Use your headset's controllers for navigation

## Building

```bash
# Web
pnpm build                  # outputs to packages/web/dist/

# Desktop
pnpm dist:desktop:mac       # macOS .dmg + .zip
pnpm dist:desktop:win       # Windows installer
pnpm dist:desktop:linux     # Linux .AppImage / .deb / .rpm
pnpm dist:desktop:all       # All platforms

# Mobile (requires EAS CLI)
pnpm build:mobile:ios
pnpm build:mobile:android
```

## License

MIT
