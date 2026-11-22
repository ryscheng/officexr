import type { Store } from '@officexr/sdk';
import { MissionsPanel, type MissionsPanelProps } from './MissionsPanel';
import { useMissionDistances, useOfficePeople } from './useOfficeSpots';

export function ConnectedMissionsPanel({ store, ...props }: Omit<MissionsPanelProps, 'people' | 'distances'> & { store: Store }) {
  const distances = useMissionDistances(store, props.missions.missions, props.areas);
  return <MissionsPanel {...props} people={useOfficePeople(store)} distances={distances} />;
}
