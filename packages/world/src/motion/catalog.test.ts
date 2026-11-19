import { describe, expect, it } from 'vitest';
import catalogJson from '../../world-object-kinds.json' with { type: 'json' };
import poolPartyMap from '../../maps/pool_party.json' with { type: 'json' };
import poolPartyRoom from '../../rooms/pool-party.json' with { type: 'json' };
import { PLACEABLE_KINDS } from '@officexr/sdk';
import { catalogKindLookup, validateWorldObjectKindCatalog } from '../scenes/world-object-kinds-schema.ts';

describe('the committed catalog and the pool party sample', () => {
  const kind = catalogKindLookup(validateWorldObjectKindCatalog(catalogJson));

  it('declares a pool with water, and two vehicle racks', () => {
    expect(kind('prop_pool')?.water).toEqual({ surfaceHeight: 0.38, rim: 0.4 });
    expect(kind('prop_scooter_rack')?.ride).toEqual({ vehicle: 'scooter' });
    expect(kind('prop_tricycle_rack')?.ride).toEqual({ vehicle: 'tricycle' });
  });

  it('declares a wand stand that turns into an empty stand while the wand is held, and every placeable kind exists', () => {
    expect(kind('prop_wand_stand')?.holdable).toEqual({ item: 'wand', emptyKindId: 'prop_wand_stand_empty' });
    expect(kind('prop_wand_stand_empty')?.holdable).toBeUndefined();
    for (const { kindId } of PLACEABLE_KINDS) expect(kind(kindId), kindId).toBeDefined();
  });

  it('gives the pool a rim collider that leaves the water open', () => {
    const shape = kind('prop_pool')?.colliderShape;
    expect(shape?.kind).toBe('scanned-cuboids');
    if (shape?.kind !== 'scanned-cuboids') return;
    const inside = shape.cuboids.some((c) => c.min[0] < 0.5 && c.max[0] > 0.5 && c.min[2] < 0.5 && c.max[2] > 0.5);
    expect(inside).toBe(false);
  });

  it('places each of them in the sample room, and the sample map uses that room', () => {
    const placed = poolPartyRoom.commands.map((c) => c.kindId).sort();
    expect(placed).toEqual(['prop_pool', 'prop_scooter_rack', 'prop_tricycle_rack']);
    for (const id of placed) expect(kind(id)).toBeDefined();
    expect(poolPartyMap.rooms.map((r) => r.roomName)).toEqual([poolPartyRoom.name]);
  });
});
