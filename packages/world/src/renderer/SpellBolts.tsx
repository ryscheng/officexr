import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { SPELLS, travelMs, type Bus, type SpellCast, type Store } from '@officexr/sdk';
import { boltAt, landingPoint } from '../motion/bolt.ts';
import { boltLoopCue, castCues, impactCues } from '../audio/cues.ts';
import { useSfx } from '../audio/sfx-context.tsx';

const TRAIL = 16;
const EMBERS = 9;
const SMOKE = 6;
const RAYS = 8;
const IMPACT_MS = 900;
const TRAIL_GAP_MS = 22;

interface ActiveCast {
  id: number;
  casterId: string;
  cast: SpellCast;
}

/** Draws every spell bolt in flight and its landing burst, from the `spell:cast` events on the bus. */
export function SpellBolts({ bus, store }: { bus: Bus; store: Store }) {
  const [casts, setCasts] = useState<ActiveCast[]>([]);
  const nextId = useRef(0);
  useEffect(
    () =>
      bus.on('spell:cast', ({ casterId, cast }) => {
        setCasts((prev) => [...prev.slice(-11), { id: ++nextId.current, casterId, cast }]);
      }),
    [bus],
  );
  return (
    <>
      {casts.map((c) => (
        <Bolt key={c.id} id={c.id} cast={c.cast} store={store} onDone={() => setCasts((prev) => prev.filter((p) => p.id !== c.id))} />
      ))}
    </>
  );
}

const additive = (color: string) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });

function Bolt({ id, cast, store, onDone }: { id: number; cast: SpellCast; store: Store; onDone: () => void }) {
  const spell = SPELLS[cast.spell];
  const sfx = useSfx();
  const total = travelMs(cast.spell, cast.distance);
  const landing = useMemo(() => landingPoint(cast), [cast]);
  const fire = spell.impact === 'fire';
  const age = useRef(0);
  const finished = useRef(false);
  const landedPlayed = useRef(false);
  const lastTrailAt = useRef(-Infinity);
  const history = useRef<THREE.Vector3[]>([]);
  const group = useRef<THREE.Group>(null);
  const head = useRef<THREE.Mesh>(null);
  const flash = useRef<THREE.Mesh>(null);
  const trail = useRef<(THREE.Mesh | null)[]>([]);
  const embers = useRef<(THREE.Mesh | null)[]>([]);
  const smoke = useRef<(THREE.Mesh | null)[]>([]);
  const rays = useRef<(THREE.Mesh | null)[]>([]);
  const mats = useMemo(
    () => ({
      head: additive(fire ? '#fff2b0' : spell.projectile.color),
      glow: additive(fire ? '#ff9a1f' : spell.projectile.color),
      ember: additive('#ffd45a'),
      flash: additive(fire ? '#fff0b8' : spell.projectile.color),
      smoke: new THREE.MeshBasicMaterial({ color: '#3a3532', transparent: true, depthWrite: false, fog: false }),
    }),
    [fire, spell.projectile.color],
  );
  const seeds = useMemo(() => Array.from({ length: EMBERS }, () => [Math.random() - 0.5, Math.random(), Math.random() - 0.5, Math.random()] as const), []);
  const targetPos = () => {
    const t = cast.targetId ? store.getState().players[cast.targetId]?.pos : null;
    return t ? { x: t.x, y: t.y, z: t.z } : null;
  };

  useEffect(() => {
    sfx?.play(castCues(cast)[0]);
    return () => {
      const stop = boltLoopCue(String(id), cast.spell, landing, false);
      if (stop) sfx?.play(stop);
    };
  }, [sfx, cast, id, landing]);

  useFrame((_, dt) => {
    age.current += dt * 1000;
    const state = boltAt(cast, age.current);
    const g = group.current;
    if (!g) return;
    const t = age.current / 1000;
    const flying = !state.landed;
    if (flying) {
      const loop = boltLoopCue(String(id), cast.spell, state.position, true);
      if (loop) sfx?.play(loop);
      if (age.current - lastTrailAt.current >= TRAIL_GAP_MS) {
        lastTrailAt.current = age.current;
        history.current.unshift(new THREE.Vector3(state.position.x, state.position.y, state.position.z));
        history.current.length = Math.min(history.current.length, TRAIL * 2);
      }
    } else if (!landedPlayed.current) {
      landedPlayed.current = true;
      const stop = boltLoopCue(String(id), cast.spell, landing, false);
      if (stop) sfx?.play(stop);
      for (const cue of impactCues(cast.spell, landing, cast.targetId ? targetPos() : null)) sfx?.play(cue);
    }
    const h = head.current;
    if (h) {
      h.visible = flying;
      h.position.set(state.position.x, state.position.y, state.position.z);
      const pulse = 1 + Math.sin(t * 50) * 0.12 + Math.random() * 0.08;
      h.scale.setScalar((fire ? 0.2 : 0.1) * pulse);
    }
    trail.current.forEach((m, i) => {
      if (!m) return;
      const p = history.current[Math.min(i * 2, history.current.length - 1)];
      m.visible = flying && !!p && i > 0;
      if (!m.visible || !p) return;
      const k = 1 - i / TRAIL;
      const jitter = fire ? 0.05 : 0.02;
      m.position.set(p.x + (Math.random() - 0.5) * jitter * 2, p.y + (Math.random() - 0.5) * jitter * 2 + i * 0.006, p.z + (Math.random() - 0.5) * jitter * 2);
      m.scale.setScalar((fire ? 0.19 : 0.06) * k * (0.75 + Math.random() * 0.5));
      (m.material as THREE.MeshBasicMaterial).color.set(fire ? (i < 5 ? '#ffb02e' : i < 10 ? '#ff6a14' : '#c8300a') : spell.projectile.color);
    });
    embers.current.forEach((m, i) => {
      if (!m) return;
      const p = history.current[Math.min(2 + i * 2, history.current.length - 1)];
      m.visible = flying && fire && !!p && Math.random() > 0.15;
      if (!m.visible || !p) return;
      const [sx, sy, sz, ss] = seeds[i];
      m.position.set(p.x + sx * 0.35, p.y + sy * 0.3 + (t * 0.6 + ss) % 0.4, p.z + sz * 0.35);
      m.scale.setScalar(0.022 + ss * 0.02);
    });
    const impactAge = age.current - total;
    const f = flash.current;
    if (f) {
      f.visible = state.landed && impactAge < 420;
      const k = Math.min(1, impactAge / 420);
      f.position.set(landing.x, landing.y, landing.z);
      f.scale.setScalar((fire ? 0.35 : 0.2) + k * (fire ? 1.5 : 0.7));
      mats.flash.opacity = Math.max(0, 1 - k);
    }
    smoke.current.forEach((m, i) => {
      if (!m) return;
      const k = Math.min(1, impactAge / IMPACT_MS);
      m.visible = fire && state.landed && k < 1;
      if (!m.visible) return;
      const a = (i / SMOKE) * Math.PI * 2;
      m.position.set(landing.x + Math.cos(a) * 0.3 * k, landing.y + 0.1 + k * (0.9 + i * 0.08), landing.z + Math.sin(a) * 0.3 * k);
      m.scale.setScalar(0.18 + k * 0.5);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.7;
    });
    rays.current.forEach((m, i) => {
      if (!m) return;
      const k = Math.min(1, impactAge / 520);
      m.visible = !fire && state.landed && k < 1;
      if (!m.visible) return;
      const a = (i / RAYS) * Math.PI * 2;
      m.position.set(landing.x + Math.cos(a) * 0.55 * k, landing.y + Math.sin(a) * 0.55 * k, landing.z);
      m.scale.setScalar(0.06 * (1 - k) + 0.01);
    });
    if (state.landed && impactAge >= IMPACT_MS && !finished.current) {
      finished.current = true;
      onDone();
    }
  });

  return (
    <group ref={group} renderOrder={12}>
      <mesh ref={head} material={mats.head}>
        <sphereGeometry args={[1, 14, 10]} />
      </mesh>
      {Array.from({ length: TRAIL }, (_, i) => (
        <mesh key={`t${i}`} ref={(m) => void (trail.current[i] = m)} material={fire ? additive('#ffb02e') : mats.glow} visible={false}>
          <sphereGeometry args={[1, 8, 6]} />
        </mesh>
      ))}
      {Array.from({ length: EMBERS }, (_, i) => (
        <mesh key={`e${i}`} ref={(m) => void (embers.current[i] = m)} material={mats.ember} visible={false}>
          <sphereGeometry args={[1, 6, 4]} />
        </mesh>
      ))}
      <mesh ref={flash} material={mats.flash} visible={false}>
        <sphereGeometry args={[1, 16, 12]} />
      </mesh>
      {Array.from({ length: SMOKE }, (_, i) => (
        <mesh key={`s${i}`} ref={(m) => void (smoke.current[i] = m)} material={mats.smoke.clone()} visible={false}>
          <sphereGeometry args={[1, 10, 8]} />
        </mesh>
      ))}
      {Array.from({ length: RAYS }, (_, i) => (
        <mesh key={`r${i}`} ref={(m) => void (rays.current[i] = m)} material={mats.glow} visible={false}>
          <sphereGeometry args={[1, 6, 4]} />
        </mesh>
      ))}
    </group>
  );
}
