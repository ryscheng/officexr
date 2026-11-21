import { useEffect, useMemo, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { RealtimeStatus } from '@officexr/sdk';
import type { Identity, Office } from '@officexr/server/shared';
import { OfficeWorld, type HermeticWorld } from '../room/OfficeWorld';
import { buildHermeticSession } from './buildHermeticSession';
import { SELF_ID, SELF_NAME } from './scenarios';

const ME: Identity = { login: SELF_ID, name: SELF_NAME };
const OFFICE: Office = {
  id: 'hud-preview',
  name: 'Preview Office',
  description: null,
  map_name: 'default',
  created_by_login: SELF_ID,
  debug_enabled: false,
};

/** The real office HUD over the real scene, joined to an in-memory office seeded from `?scenario=`. */
export function HudPreview() {
  const scenario = useMemo(() => new URLSearchParams(window.location.search).get('scenario'), []);
  const stallMs = useMemo(() => Number(new URLSearchParams(window.location.search).get('stallMs')) || undefined, []);
  const [world, setWorld] = useState<(HermeticWorld & { dispose: () => void }) | null>(null);
  useEffect(() => {
    let cancelled = false;
    let built: { dispose: () => void } | undefined;
    void buildHermeticSession(scenario, stallMs).then((w) => {
      if (cancelled) {
        w.dispose();
        return;
      }
      built = w;
      setWorld(w);
    });
    return () => {
      cancelled = true;
      built?.dispose();
    };
  }, [scenario, stallMs]);
  useEffect(() => {
    if (!world) {
      return;
    }
    const { actions } = world.session.local;
    const hook = {
      say: (from: string, text: string) => actions.applyRemoteChat({ id: `say-${Date.now()}`, authorId: from, text, t: Date.now() }),
      setStatus: (status: RealtimeStatus) => actions.setRealtimeStatus(status),
      selfPos: () => world.session.local.store.getState().players[SELF_ID]?.pos ?? null,
      placeSelf: (x: number, z: number) => actions.setSelfPosition({ x, y: 2, z }, { x: 0, y: 0, z: 0 }, 0, false),
      cubeSize: () => world.session.local.store.getState().worldObjects.cubeSize,
      placedProps: () => world.session.local.store.getState().placedProps,
    };
    (window as unknown as { __hudPreview?: typeof hook }).__hudPreview = hook;
    return () => {
      delete (window as unknown as { __hudPreview?: typeof hook }).__hudPreview;
    };
  }, [world]);
  return (
    <MemoryRouter>
      <div className="fixed inset-0 touch-manipulation overflow-hidden">
        {world && <OfficeWorld office={OFFICE} me={ME} hermetic={world} />}
      </div>
    </MemoryRouter>
  );
}
