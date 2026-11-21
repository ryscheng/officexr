import type { PlaceModeStore } from '@officexr/world/motion';
import { Button } from '../ui/Button';

export function BuildDone({ mode }: { mode: PlaceModeStore }) {
  return (
    <Button tone="primary" className="pointer-events-auto min-h-12" onMouseDown={(e) => e.preventDefault()} onClick={() => mode.setOpen(false)}>
      Done
    </Button>
  );
}
