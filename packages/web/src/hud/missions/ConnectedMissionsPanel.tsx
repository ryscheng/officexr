import type { Store } from '@officexr/sdk';
import { MissionsPanel, type MissionsPanelProps } from './MissionsPanel';
import { useOfficePeople, useSelfSpot } from './useOfficeSpots';

export function ConnectedMissionsPanel({ store, ...props }: Omit<MissionsPanelProps, 'people' | 'self'> & { store: Store }) {
  return <MissionsPanel {...props} people={useOfficePeople(store)} self={useSelfSpot(store)} />;
}
