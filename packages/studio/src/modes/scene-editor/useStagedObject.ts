import { useCallback, useState } from 'react';

/** The kind the Add / Tile tools place and the yaw they place it at. */
export function useStagedObject() {
  const [stagedKindId, setStagedKindId] = useState<string | null>(null);
  const [stagedYawDeg, setStagedYawDeg] = useState(0);
  const stageKind = useCallback((kindId: string | null) => {
    setStagedKindId(kindId);
    // A new kind may have a coarser rotation step than the current yaw.
    setStagedYawDeg(0);
  }, []);
  return { stagedKindId, stagedYawDeg, setStagedYawDeg, stageKind };
}
