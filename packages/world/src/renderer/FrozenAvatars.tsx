import { Suspense, useEffect, useState } from 'react';
import { Html } from '@react-three/drei';
import type { PlayerId, Store } from '@officexr/sdk';
import { frozenAvatars, sameFrozenAvatars, type FrozenAvatar } from '../app/frozen-avatars.ts';
import { useApplication, useCatalogCharacters } from '../react/application-context.tsx';
import { ANIMATION_URLS, Adventurer } from './Adventurer.tsx';
import { ModelWithFallback } from './ModelWithFallback.tsx';
import { SwapWhenLoaded } from './SwapWhenLoaded.tsx';
import { TAG_HEIGHT_M } from './PlayerNameTag.tsx';
import { AVATAR_YAW_OFFSET, feetPosition } from '../physics/rules.ts';
import type { PlayerModel } from '../characters/registry.ts';
import './FrozenAvatars.css';

const CARD_OFFSET_PX = -34;

export const frozenStatusText = (_frozen: Pick<FrozenAvatar, 'login'>): string => 'Away';

/**
 * An absent claimant's avatar left sitting at their desk. It has no physics body, so nothing
 * collides with it and it never joins proximity, voice or the call.
 */
export function FrozenAvatars({ store, onPing }: { store: Store; onPing?: (id: PlayerId) => void }) {
  const { catalog, geometry } = useApplication();
  const characters = useCatalogCharacters();
  const read = () => frozenAvatars(store.getState(), catalog, geometry, characters);
  const [avatars, setAvatars] = useState<FrozenAvatar[]>(read);
  useEffect(() => {
    const select = (s: ReturnType<Store['getState']>) => frozenAvatars(s, catalog, geometry, characters);
    setAvatars((prev) => {
      const next = select(store.getState());
      return sameFrozenAvatars(prev, next) ? prev : next;
    });
    return store.subscribe(select, setAvatars, sameFrozenAvatars);
  }, [store, catalog, geometry, characters]);
  const [openLogin, setOpenLogin] = useState<string | null>(null);
  useEffect(() => {
    if (openLogin !== null && !avatars.some((a) => a.login === openLogin)) {
      setOpenLogin(null);
    }
  }, [avatars, openLogin]);
  const charRadius = store.getState().worldSettings.charRadius;
  return (
    <>
      {avatars.map((a) => (
        <FrozenAvatarView
          key={a.login}
          avatar={a}
          charRadius={charRadius}
          open={openLogin === a.login}
          onToggle={() => setOpenLogin((cur) => (cur === a.login ? null : a.login))}
          onPing={onPing}
        />
      ))}
    </>
  );
}

const modelKey = (m: PlayerModel) => `${m.url}|${m.ghost}`;
const modelUrls = (m: PlayerModel) => [m.url, ...ANIMATION_URLS];

function FrozenAvatarView(props: {
  avatar: FrozenAvatar;
  charRadius: number;
  open: boolean;
  onToggle: () => void;
  onPing?: (id: PlayerId) => void;
}) {
  const { avatar, charRadius, open, onToggle, onPing } = props;
  const feet = feetPosition(avatar.pos, charRadius);
  const status = frozenStatusText(avatar);
  return (
    <group position={[feet.x, feet.y, feet.z]} rotation={[0, avatar.yaw + AVATAR_YAW_OFFSET, 0]}>
      <Suspense fallback={null}>
        <SwapWhenLoaded
          value={avatar.model}
          keyOf={modelKey}
          urlsOf={modelUrls}
          render={(model) => (
            <ModelWithFallback
              key={modelKey(model)}
              url={model.url}
              fallbackUrl={model.fallbackUrl}
              render={(url) => <Adventurer url={url} frozen motion="sitting" />}
            />
          )}
        />
      </Suspense>
      <mesh
        position={[0, TAG_HEIGHT_M / 2, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <capsuleGeometry args={[charRadius, TAG_HEIGHT_M - 2 * charRadius]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <Html center position={[0, TAG_HEIGHT_M, 0]} zIndexRange={[1, 0]}>
        <div className="frozen-tag" onClick={onToggle}>
          <div className="frozen-tag-zzz" aria-hidden>
            z z
          </div>
          <div className="frozen-tag-name">{avatar.name}</div>
          <div className="frozen-tag-status">{status}</div>
        </div>
        {open && (
          <div className="frozen-card" role="dialog" aria-label={`${avatar.name} is away`} style={{ transform: `translateY(${CARD_OFFSET_PX}px)` }}>
            <div className="frozen-card-name">{avatar.name}</div>
            <div className="frozen-card-status">{status}</div>
            <div className="frozen-card-actions">
              {onPing && (
                <button type="button" onClick={() => onPing(avatar.login)}>
                  Ping
                </button>
              )}
              <button type="button" onClick={onToggle} aria-label="Close">
                Close
              </button>
            </div>
          </div>
        )}
      </Html>
    </group>
  );
}
