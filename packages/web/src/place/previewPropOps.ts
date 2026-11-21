import { MAX_PLACED_PROPS, type Actions, type PropOpResult, type Store } from '@officexr/sdk';
import type { RequestPropOp } from './requestPropOp';

export function createPreviewPropOps(store: Store, actions: Actions): RequestPropOp {
  let counter = 1000;
  return async (op): Promise<PropOpResult> => {
    const props = store.getState().placedProps;
    if (op.op === 'place') {
      if (props.length >= MAX_PLACED_PROPS) {
        return { ok: false, error: 'limit' };
      }
      actions.setPlacedProps([...props, { id: `placed:${++counter}`, kindId: op.kindId, position: op.position, yawDeg: op.yawDeg }]);
      return { ok: true };
    }
    if (!props.some((p) => p.id === op.id)) {
      return { ok: false, error: 'not-found' };
    }
    actions.setPlacedProps(op.op === 'remove' ? props.filter((p) => p.id !== op.id) : props.map((p) => (p.id === op.id ? { ...p, position: op.position, yawDeg: op.yawDeg } : p)));
    return { ok: true };
  };
}
