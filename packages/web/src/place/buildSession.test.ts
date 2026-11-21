import { describe, expect, it, vi } from 'vitest';
import type { PlacedProp, PropOp, PropOpResult } from '@officexr/sdk';
import { createPlaceMode } from '@officexr/world/motion';
import { createBuildSession } from './buildSession';
import type { RequestPropOp } from './requestPropOp';

const pool = (id: string): PlacedProp => ({ id, kindId: 'prop_pool', position: [4, 0, 6], yawDeg: 90 });
const place: PropOp = { op: 'place', kindId: 'prop_pool', position: [4, 0, 6], yawDeg: 90 };

function setup(result: PropOpResult = { ok: true }, placed: PlacedProp[] = [pool('placed:7')]) {
  const mode = createPlaceMode();
  const send = vi.fn<RequestPropOp>(async () => result);
  const session = createBuildSession(mode, send, () => placed);
  return { mode, send, session };
}

describe('createBuildSession', () => {
  it('passes the op to the server and remembers a placement that succeeded', async () => {
    const { session, send } = setup();
    await expect(session.host.send(place)).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(place);
    expect(session.last()).toMatchObject({ kindId: 'prop_pool', position: [4, 0, 6], yawDeg: 90 });
  });

  it('remembers nothing for a failed placement or for another op', async () => {
    const failed = setup({ ok: false, error: 'limit' });
    await failed.session.host.send(place);
    expect(failed.session.last()).toBeNull();
    const removed = setup();
    await removed.session.host.send({ op: 'remove', id: 'placed:7' });
    expect(removed.session.last()).toBeNull();
  });

  it('tells subscribers when the last placement changes', async () => {
    const { session } = setup();
    const listener = vi.fn();
    const off = session.subscribe(listener);
    await session.host.send(place);
    session.dismiss();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    await session.host.send(place);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('undo removes the prop that sits where the last one was placed, and clears the note', async () => {
    const { session, send } = setup(undefined, [{ ...pool('placed:3'), position: [1, 0, 1] }, pool('placed:7')]);
    await session.host.send(place);
    await session.undo();
    expect(send).toHaveBeenLastCalledWith({ op: 'remove', id: 'placed:7' });
    expect(session.last()).toBeNull();
  });

  it('undo does nothing without a note or when the prop is gone', async () => {
    const { session, send } = setup(undefined, []);
    await session.undo();
    await session.host.send(place);
    await session.undo();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('undo shows why the server refused', async () => {
    const mode = createPlaceMode();
    const send = vi.fn(async (op: PropOp): Promise<PropOpResult> => (op.op === 'remove' ? { ok: false, error: 'not-found' } : { ok: true }));
    const session = createBuildSession(mode, send, () => [pool('placed:7')]);
    await session.host.send(place);
    await session.undo();
    expect(mode.get().notice).toBe('That prop is already gone.');
  });
});
