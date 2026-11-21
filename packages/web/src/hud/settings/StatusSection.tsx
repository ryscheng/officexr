import { Hand } from 'lucide-react';
import type { Actions, PlayerId, Store } from '@officexr/sdk';
import { useSelfStatus } from '../../status/useSelfStatus';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';

type Availability = 'available' | 'focus';

const OPTIONS: readonly { value: Availability; label: string }[] = [
  { value: 'available', label: 'Available' },
  { value: 'focus', label: 'Focus' },
];

export function StatusSection({ store, actions, selfId }: { store: Store; actions: Pick<Actions, 'setSelfRichStatus' | 'setSelfHand'>; selfId: PlayerId }) {
  const { focus, handRaised, toggleFocus, toggleHand } = useSelfStatus(store, actions, selfId);
  return (
    <>
      <h3 className="px-1 text-sm font-semibold text-hud-text-2">Status</h3>
      <SegmentedControl<Availability>
        aria-label="Status"
        fill
        value={focus ? 'focus' : 'available'}
        options={OPTIONS}
        onValueChange={(next) => next !== (focus ? 'focus' : 'available') && toggleFocus()}
      />
      <Button className="min-h-12 w-full" aria-pressed={handRaised} onClick={toggleHand}>
        <Hand aria-hidden className="size-4" />
        {handRaised ? 'Lower hand' : 'Raise hand'}
      </Button>
    </>
  );
}
