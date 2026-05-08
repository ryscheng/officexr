# OfficeXR Architecture

> Living document. Intended as a baseline reference we can use when discussing
> refactors / a "better" architecture in subsequent changes.

OfficeXR is a pnpm monorepo with a single source-of-truth React/Three.js
codebase (`@officexr/core`) wrapped by three platform shells (web, desktop,
mobile). The backend is "serverless" — Supabase handles auth, persistence, and
realtime; JaaS (Jitsi as a Service) handles voice/video. The web client mints
its own JaaS JWT via the Web Crypto API, so there is no custom backend service
to operate.

## 1. System Architecture (clients + backend services)

```mermaid
flowchart LR
    subgraph Clients["Client shells"]
        Web["@officexr/web<br/>Vite + React 19"]
        Desktop["@officexr/desktop<br/>Electron wrapper"]
        Mobile["@officexr/mobile<br/>Expo / React Native"]
    end

    subgraph Core["@officexr/core (shared)"]
        ReactApp["React 19 SPA<br/>react-router"]
        ThreeJS["Three.js + WebXR<br/>3D scene + avatars"]
    end

    subgraph Backend["Backend services (serverless)"]
        SBAuth["Supabase Auth<br/>Google OAuth"]
        SBDB[("Supabase Postgres<br/>profiles · offices ·<br/>office_members · office_skins")]
        SBRT["Supabase Realtime<br/>presence + broadcast"]
        JaaS["JaaS / Jitsi<br/>voice + video"]
        Google["Google OAuth"]
    end

    Web --> Core
    Desktop -- "loads built<br/>SPA via app://" --> Core
    Mobile -. "shares hooks /<br/>supabase client" .-> Core

    ReactApp --> SBAuth
    ReactApp --> SBDB
    ThreeJS --> SBRT
    ThreeJS --> JaaS
    SBAuth --> Google

    classDef client fill:#1e293b,stroke:#38bdf8,color:#e2e8f0
    classDef core fill:#312e81,stroke:#a78bfa,color:#ede9fe
    classDef svc fill:#064e3b,stroke:#34d399,color:#d1fae5
    class Web,Desktop,Mobile client
    class ReactApp,ThreeJS core
    class SBAuth,SBDB,SBRT,JaaS,Google svc
```

## 2. Application Layers (inside `@officexr/core`)

The core package is conventional layered React: presentation components →
custom hooks → lib/data → external services. The 3D scene (`RoomScene`) is
the central composition root that wires every subsystem hook together.

```mermaid
flowchart TB
    subgraph Pres["Presentation layer (components/, pages/)"]
        Pages["pages/<br/>Home · Login · RoomPage"]
        Lobby["UserLobby ·<br/>OfficeSelector ·<br/>SettingsPanel"]
        Scene["RoomScene<br/>(3D composition root)"]
        RoomUI["components/room/<br/>ChatPanel · UserPanel ·<br/>InventoryPanel · LootBox ·<br/>JitsiMeetingContainer ·<br/>ScreenShare · LoginModal ·<br/>VirtualJoystick · Crosshair"]
        Three3D["Three.js objects<br/>Avatar · WhiteboardCanvas ·<br/>EmojiConfetti · LootBoxEffect"]
        Zombie["zombie/<br/>ZombieOverlay · ZombieHUD ·<br/>useZombieGame (mini-game)"]
    end

    subgraph Logic["State / hooks layer (hooks/)"]
        Auth["useAuth"]
        SceneHk["useSceneSetup<br/>(renderer, camera, HDRI)"]
        Channel["useRealtimeChannel<br/>(Supabase channel mgr)"]
        Presence["usePresence<br/>(positions, proximity)"]
        Chat["useChat"]
        Jitsi["useJitsi<br/>(proximity voice)"]
        Screen["useScreenSharing<br/>(WebRTC + STUN)"]
        Whiteboard["useWhiteboard"]
        Shoot["useShooting"]
        Loot["useLootBox"]
        Avatar["useAvatarCustomization"]
        Input["useKeyboardControls ·<br/>useMotionControls"]
        Net["useNetworkStats ·<br/>useChannelLogger"]
    end

    subgraph Data["Data / lib layer"]
        Supa["lib/supabase.ts<br/>typed client + Database<>"]
        JWT["lib/jaasJwt.ts<br/>RS256 JWT (Web Crypto)"]
        LootData["data/lootBoxItems.ts"]
        Types["types/<br/>avatar · room"]
    end

    subgraph Ext["External services"]
        SB[("Supabase<br/>Auth + DB + Realtime")]
        JaaSExt["JaaS / Jitsi"]
        WebRTC["Browser WebRTC<br/>(getDisplayMedia, RTCPeer)"]
        LS["localStorage<br/>(inventory, cooldown)"]
    end

    Pages --> Scene
    Pages --> Lobby
    Scene --> RoomUI
    Scene --> Three3D
    Scene --> Zombie

    Scene --> SceneHk
    Scene --> Channel
    Scene --> Presence
    Scene --> Chat
    Scene --> Jitsi
    Scene --> Screen
    Scene --> Whiteboard
    Scene --> Shoot
    Scene --> Loot
    Scene --> Avatar
    Scene --> Input
    Scene --> Net
    Lobby --> Auth
    Pages --> Auth

    Auth --> Supa
    Channel --> Supa
    Presence --> Channel
    Chat --> Channel
    Whiteboard --> Channel
    Screen --> Channel
    Jitsi --> JWT
    Avatar --> Supa
    Loot --> LootData
    Loot --> LS

    Supa --> SB
    JWT --> JaaSExt
    Jitsi --> JaaSExt
    Screen --> WebRTC

    classDef pres fill:#1e3a8a,stroke:#60a5fa,color:#dbeafe
    classDef logic fill:#312e81,stroke:#a78bfa,color:#ede9fe
    classDef data fill:#064e3b,stroke:#34d399,color:#d1fae5
    classDef ext fill:#3f1d1d,stroke:#f87171,color:#fee2e2
    class Pages,Lobby,Scene,RoomUI,Three3D,Zombie pres
    class Auth,SceneHk,Channel,Presence,Chat,Jitsi,Screen,Whiteboard,Shoot,Loot,Avatar,Input,Net logic
    class Supa,JWT,LootData,Types data
    class SB,JaaSExt,WebRTC,LS ext
```

## 3. Realtime, Voice & Media Subsystems

Each room is one Supabase Realtime channel multiplexing several event streams,
plus two out-of-band media subsystems (voice via JaaS iframe, screen sharing
via direct WebRTC peer connections signaled over the same channel).

```mermaid
flowchart LR
    subgraph Local["Local client (browser)"]
        Tick["Frame tick<br/>(setAnimationLoop)"]
        PresHk["usePresence"]
        ChatHk["useChat"]
        WBHk["useWhiteboard"]
        ShootHk["useShooting"]
        ScreenHk["useScreenSharing"]
        JitsiHk["useJitsi"]
        Iframe["Jitsi IFrame API<br/>(JitsiMeetingContainer)"]
        ZombieHk["useZombieGame"]
    end

    subgraph Channel["Supabase Realtime channel: room:{officeId}"]
        Track["presence.track<br/>(position, yaw, avatar)"]
        BCPos["broadcast: position"]
        BCChat["broadcast: chat"]
        BCDraw["broadcast: stroke / clear"]
        BCHit["broadcast: hit"]
        BCSig["broadcast: webrtc-offer /<br/>answer / ice"]
        BCZom["broadcast: zombie-positions /<br/>zombie-spawn / zombie-kill /<br/>zombie-state"]
    end

    subgraph Voice["Proximity voice (JaaS)"]
        JWTGen["jaasJwt.ts<br/>RS256 sign in browser"]
        JaaSRoom["JaaS room<br/>(8x8.vc iframe)"]
    end

    subgraph Peers["WebRTC peers"]
        PC["RTCPeerConnection<br/>+ Google STUN"]
        Remote["Remote screen tracks"]
    end

    Tick --> PresHk
    PresHk --> Track
    PresHk --> BCPos
    ChatHk --> BCChat
    WBHk --> BCDraw
    ShootHk --> BCHit
    ScreenHk --> BCSig
    BCSig --> PC
    PC --> Remote
    ZombieHk --> BCZom

    JitsiHk --> JWTGen
    JWTGen --> Iframe
    Iframe --> JaaSRoom
    PresHk -. "computes nearby<br/>users → triggers<br/>join/leave room" .-> JitsiHk

    classDef local fill:#1e3a8a,stroke:#60a5fa,color:#dbeafe
    classDef chan fill:#3f1d8a,stroke:#a78bfa,color:#ede9fe
    classDef voice fill:#064e3b,stroke:#34d399,color:#d1fae5
    classDef peer fill:#7c2d12,stroke:#fb923c,color:#ffedd5
    class Tick,PresHk,ChatHk,WBHk,ShootHk,ScreenHk,JitsiHk,Iframe,ZombieHk local
    class Track,BCPos,BCChat,BCDraw,BCHit,BCSig,BCZom chan
    class JWTGen,JaaSRoom voice
    class PC,Remote peer
```

## 4. Local Game State & Rendering

Yes — there is meaningful local game state, but it is **not cleanly separated
from rendering**. State lives in five different places and is read/written
imperatively from the same animation loop that draws the scene.

### Where state lives today

| Bucket                       | Lifetime          | Triggers React render? | Examples |
|------------------------------|-------------------|------------------------|---------|
| **React `useState`**         | component mount   | Yes                    | `phase`, `wave`, `totalKills`, `playerHealths`, `deadPlayers`, `showLootBox`, `showInventory`, `chatVisible`, `environment`, `zoomLevel`, `followingUserId`, `realtimeRetryAt`, `showLoginModal` |
| **React `useRef` (mutable)** | component mount   | No (read each frame)   | `playerPositionRef`, `cameraRef`, `cameraModeRef`, `keysRef`, `joystickInputRef`, `presenceDataRef`, `avatarsRef`, `avatarTargetsRef`, `avatarPrevPositionsRef`, `bubbleSpheresRef`, `nearbyUserIdsRef`, `phaseRef`, `waveRef`, `zombieEntitiesRef`, `playerHealthsRef`, `localPlayerHpRef`, `isLocalPlayerDeadRef`, `hostIdRef`, `targetZombiePosRef`, `processedKillsRef`, `pauseProximityDetectionRef`, `wbToggleRef`, `fireEmojiRef`, bullet & particle arrays |
| **Three.js scene graph**     | scene lifetime    | No                     | `Avatar` `THREE.Group`s, bubble spheres, whiteboard floor mesh, bullet meshes, confetti sprites, loot-box overhead effects, zombie meshes, HDRI skybox |
| **`localStorage`**           | cross-session     | No                     | `officexr_inventory`, `officexr_lootbox_cooldown`, debug-panel toggle |
| **Supabase Postgres**        | persistent server | No (RPC on mount)      | `profiles`, `offices`, `office_members`, `office_skins` (incl. per-room avatar overrides) |
| **Supabase Realtime**        | ephemeral, room   | Indirect via listeners | live presence, chat broadcasts, whiteboard strokes, hit events, WebRTC signals, zombie host broadcasts |

A consistent pattern in the zombie subsystem (and elsewhere) is that
authoritative state is held in a **ref** (so the animation loop reads it
without stale closures) **and** mirrored into React state via a `setPhaseSync`
/ `setWaveSync` helper purely so the HUD re-renders. The two are kept in sync
manually.

### How rendering is (not) separated

```mermaid
flowchart TB
    subgraph Inputs["Input sources"]
        KB["Keyboard / mouse<br/>(useKeyboardControls)"]
        Touch["Joystick / gyro<br/>(useMotionControls)"]
        XR["WebXR controllers"]
        Net["Realtime broadcasts<br/>(remote players,<br/>zombies, strokes, hits)"]
    end

    subgraph LocalState["Local game state"]
        ReactSt["React state<br/>(HUD, modals, phase)"]
        Refs["Refs<br/>(player pos, camera mode,<br/>zombie entities, healths,<br/>presence map, bullets)"]
        SceneGraph["Three.js scene graph<br/>(meshes / groups —<br/>state + visual co-located)"]
        LS["localStorage<br/>(inventory, cooldowns)"]
    end

    subgraph Loop["renderer.setAnimationLoop(animate) — every frame"]
        Move["computeMovement()<br/>player + camera kinematics"]
        TickP["tickPresence()<br/>broadcast pos, lerp remote avatars,<br/>proximity → Jitsi join/leave"]
        TickZ["updateZombies()<br/>host AI step, lerp non-host,<br/>damage accum, kills"]
        TickB["updateBullets() · updateParticles()<br/>· loot effects · whiteboard texture"]
        Render["renderer.render(scene, camera)"]
    end

    subgraph UI["React render tree"]
        HUD["HUD / overlays<br/>ChatPanel · UserPanel ·<br/>ZombieHUD · InventoryPanel ·<br/>ControlsOverlay"]
    end

    KB --> Refs
    Touch --> Refs
    XR --> Refs
    Net --> Refs
    Net --> ReactSt

    Refs --> Move
    Refs --> TickP
    Refs --> TickZ
    Refs --> TickB
    Move --> SceneGraph
    TickP --> SceneGraph
    TickZ --> SceneGraph
    TickB --> SceneGraph
    SceneGraph --> Render

    LS <--> Refs
    Refs -. "setXSync()<br/>mirror to React" .-> ReactSt
    ReactSt --> HUD

    classDef in fill:#1e3a8a,stroke:#60a5fa,color:#dbeafe
    classDef st fill:#312e81,stroke:#a78bfa,color:#ede9fe
    classDef loop fill:#3f1d1d,stroke:#f87171,color:#fee2e2
    classDef ui fill:#064e3b,stroke:#34d399,color:#d1fae5
    class KB,Touch,XR,Net in
    class ReactSt,Refs,SceneGraph,LS st
    class Move,TickP,TickZ,TickB,Render loop
    class HUD ui
```

### Observations relevant to a future refactor

- **No game-state model.** There is no single `GameState` object or store
  (Redux/Zustand/ECS). State is scattered across ~20 refs + ~9 useState
  declarations in `RoomScene` alone, plus per-hook internal refs.
- **State and rendering are co-located.** Zombie HP, player HP, bullet
  trajectories, etc. are stored as fields on Three.js `Group`s or in parallel
  ref-Maps keyed by entity id. There is no headless "simulation" you could
  run server-side or in a worker.
- **Two-source-of-truth pattern.** Zombie phase/wave/kills/healths exist as
  both `useRef` and `useState`, kept in sync with manual setter helpers — easy
  to drift.
- **Animation loop is the orchestrator.** `RoomScene.animate()` directly
  calls `tickPresence`, `updateZombies`, `updateBullets`, `wbUpdateFloorTexture`,
  and `renderer.render`. There is no fixed-timestep simulation, no
  interpolation/extrapolation layer, no separation between "advance the world"
  and "draw the world".
- **Networking is partially authoritative.** Zombie AI uses an
  elected-host-broadcasts-positions model (lex-min living player id);
  everything else (presence, hits, strokes) is peer-trusted.
- **Persistence is split by concern, not by layer.** Server: identity,
  membership, avatar customization. Local: inventory, cooldowns. Ephemeral:
  positions and game progress (lost on refresh).

## 5. Data Layer (Supabase)

Persistence is a small Postgres schema with row-level security. Access to a
room is gated by the `join_office_if_allowed` RPC, called by `RoomPage`
before mounting the 3D scene.

- `profiles` — one per auth user; default avatar customization fields.
- `offices` — rooms; `environment` selects the 3D scene preset; `link_access`
  toggles open-by-link join.
- `office_members` — membership + role (`owner | admin | member`) +
  per-room avatar overrides.
- `office_skins` — uploaded GLB models attached to an office.
- RPC `join_office_if_allowed(p_office_id)` → `'ready' | 'denied' | 'not-found'`.

SQL migrations live in `supabase/migrations/` and are applied automatically on
push to `main` by `.github/workflows/supabase-migrations.yml`.
