import { LocateFixed, Minus, Plus } from 'lucide-react';
import { useCameraControls } from '@officexr/world/top-down';
import { IconButton } from './IconButton';
import { Panel } from './ui/Panel';

/** Zoom and re-centre buttons for the 2D map; renders nothing in the 3D view, which has no 2D camera. */
export function ZoomControls() {
  const camera = useCameraControls();
  if (!camera) {
    return null;
  }
  const { controls, snapshot } = camera;
  return (
    <Panel role="group" aria-label="Map zoom" className="pointer-events-auto flex flex-col gap-1 p-1">
      <IconButton icon={Plus} label="Zoom in (+)" disabled={!snapshot.canZoomIn} onClick={() => controls.zoomIn()} />
      <IconButton icon={Minus} label="Zoom out (−)" disabled={!snapshot.canZoomOut} onClick={() => controls.zoomOut()} />
      <IconButton
        icon={LocateFixed}
        label="Centre on me (0)"
        pressed={snapshot.following}
        tone={snapshot.following ? 'neutral' : 'accent'}
        onClick={() => controls.recentre()}
      />
    </Panel>
  );
}
