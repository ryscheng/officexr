import React, { useEffect, useState } from 'react';
import { Scene } from '@officexr/world/renderer';
import { CHARACTERS } from '@officexr/world';
import type { CharacterName } from '@officexr/world';
import {
  buildInMemoryStack,
  createPersistentLocalState,
  type ChannelStack,
  type PersistentLocalState,
} from '../../realtime/services.ts';
import { DEFAULT_VIEW_CONFIG, type ViewConfig } from '../../panels/world/types.ts';

const SELF_ID = 'mugshot-player';
const OFFICE_ID = 'mugshot';
const DEFAULT_CHARACTER: CharacterName = 'Barbarian';

/**
 * Parse the active character from the URL hash. Supports both
 * `#mugshot` (default character) and `#mugshot/<CharacterName>` so a
 * Playwright spec or a bookmarkable link can target a specific
 * baseline without going through the picker UI.
 */
function readCharacterFromHash(): CharacterName {
  if (typeof window === 'undefined') return DEFAULT_CHARACTER;
  const parts = window.location.hash.replace(/^#/, '').split('/');
  const candidate = parts[1];
  if (candidate && (CHARACTERS as readonly string[]).includes(candidate)) {
    return candidate as CharacterName;
  }
  return DEFAULT_CHARACTER;
}

/** The mugshot scene: a 2×2 cube square at voxel y=0, alternating
 * blue and stone. Top face is at world y=2. */
const MUGSHOT_CUBES: ReadonlyArray<{
  id: string;
  sourceCommandId: string;
  kindId: string;
  position: [number, number, number];
}> = [
  { id: 'm-0-0', sourceCommandId: 'mugshot', kindId: 'colored_block_blue', position: [0, 0, 0] },
  { id: 'm-1-0', sourceCommandId: 'mugshot', kindId: 'stone', position: [1, 0, 0] },
  { id: 'm-0-1', sourceCommandId: 'mugshot', kindId: 'stone', position: [0, 0, 1] },
  { id: 'm-1-1', sourceCommandId: 'mugshot', kindId: 'colored_block_blue', position: [1, 0, 1] },
];

/** Fixed-camera viewConfig tuned for a mugshot framing: front-on,
 * eye-level, zoomed-out FOV, narrow leash so the framing is
 * deterministic. Shadow sun-disc is hidden — a bright disc in the
 * sky would dominate any pixel diff. */
const MUGSHOT_VIEW_CONFIG: ViewConfig = {
  ...DEFAULT_VIEW_CONFIG,
  fixedCamera: {
    ...DEFAULT_VIEW_CONFIG.fixedCamera,
    azimuthDeg: 180,
    pitchDeg: -8,
    height: 1.7,
    fov: 40,
    maxOnScreenFrac: 0.45,
    minOnScreenFrac: 0.4,
    lateralFrac: 0,
  },
  lighting: {
    ...DEFAULT_VIEW_CONFIG.lighting,
    showSunDisc: false,
  },
};

/**
 * Mugshot mode: a deterministic 2×2 cube scene with a paused
 * character (no animation), framed for snapshot testing of
 * "character actually stands ON surfaces, not through them". Reuses
 * the same `<Scene>` component the game uses so the rendering path
 * is bit-for-bit identical to Debug — the only behavioral switch is
 * `paused={true}`.
 *
 * The Playwright spec at `tests/playwright/character-on-surface.spec.ts`
 * navigates to `#mugshot/<CharacterName>` per character and asserts
 * the captured frame against a committed baseline PNG.
 *
 * For humans: a small picker in the corner cycles through the 6
 * characters by mutating the URL hash, which triggers a fresh Scene
 * mount via the `key` prop so the rigid body + character GLB
 * actually swap.
 */
export function MugshotApp() {
  const [local, setLocal] = useState<PersistentLocalState | null>(null);
  const [stack, setStack] = useState<ChannelStack | null>(null);
  const [character, setCharacter] = useState<CharacterName>(() =>
    readCharacterFromHash(),
  );

  // Listen for hash changes so `#mugshot/Knight` etc. live-switches.
  useEffect(() => {
    const onHashChange = () => setCharacter(readCharacterFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Bootstrap: build the local-player + in-memory stack once.
  useEffect(() => {
    // A muted Audio element satisfies buildInMemoryStack's
    // signature without producing sound — there's no elevator music
    // for the mugshot mode.
    const audio = new Audio();
    audio.volume = 0;

    const lp = createPersistentLocalState({
      selfId: SELF_ID,
      officeId: OFFICE_ID,
      // Drop the player from y=4 onto the cube tops at y=2 — gravity
      // (driven by `<Physics gravity=[0,-20,0]>` + the kinematic
      // character controller in SceneFrame) settles them in ~0.5 s.
      startPos: { x: 1, y: 4, z: 1 },
    });
    setLocal(lp);
    (window as unknown as { __OFFICE_STORE__: typeof lp.store }).__OFFICE_STORE__ =
      lp.store;

    let built: ChannelStack | null = null;
    let cancelled = false;
    buildInMemoryStack({ local: lp, audio })
      .then((s) => {
        if (cancelled) {
          void s.teardown();
          return;
        }
        built = s;
        s.bots.setCount(0).catch(() => {});
        setStack(s);
      })
      .catch((err) => {
        console.warn('[mugshot] stack build failed:', err);
      });

    return () => {
      cancelled = true;
      if (built) void built.teardown();
    };
  }, []);

  // Push the cube field as soon as `local` is ready.
  useEffect(() => {
    if (!local) return;
    local.actions.setWorldObjects({
      cubeSize: 2,
      instances: MUGSHOT_CUBES.map((c) => ({ ...c })),
    });
  }, [local]);

  // Force the rendered character via `avatar.model`. Players.tsx's
  // `pickCharacterForPlayer` honors a valid CharacterName here and
  // renders that GLB instead of a random pick.
  useEffect(() => {
    if (!local) return;
    local.actions.upsertPlayer({
      id: SELF_ID,
      avatar: { model: character },
    });
  }, [local, character]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        minWidth: 0,
        minHeight: 0,
        position: 'relative',
      }}
    >
      <main
        style={{
          flex: 1,
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {stack && local && (
          // `key={character}` forces a fresh Scene mount when the
          // picker changes character. Players.tsx reads
          // `state.players[id].avatar.model` ONCE at mount to choose
          // the rendered GLB — without the remount, an
          // already-rendered Barbarian would stay on screen even
          // after avatar.model flips to Knight.
          <Scene
            key={character}
            store={local.store}
            actions={local.actions}
            rules={local.rules}
            bus={local.bus}
            sync={stack.sync}
            handshake={stack.handshake}
            bots={stack.bots}
            selfId={SELF_ID}
            cameraMode="fixed"
            viewConfig={MUGSHOT_VIEW_CONFIG}
            worldFocused={false}
            paused={true}
            spawnPoints={[]}
          />
        )}
        <CharacterPicker
          active={character}
          onPick={(c) => {
            window.location.hash = `mugshot/${c}`;
          }}
        />
      </main>
    </div>
  );
}

function CharacterPicker({
  active,
  onPick,
}: {
  active: CharacterName;
  onPick: (c: CharacterName) => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        padding: 8,
        background: 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        font: '12px system-ui, sans-serif',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        zIndex: 10,
      }}
    >
      <div style={{ opacity: 0.7, marginBottom: 4 }}>character</div>
      {CHARACTERS.map((c) => {
        const isActive = c === active;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            style={{
              padding: '4px 10px',
              border: 0,
              borderRadius: 3,
              background: isActive ? '#3b82f6' : 'transparent',
              color: isActive ? '#fff' : '#cbd5e1',
              cursor: 'pointer',
              fontSize: 12,
              textAlign: 'left',
            }}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
