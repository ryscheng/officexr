import { POSITION_QUANTUM_VOXELS } from '@officexr/world/scenes';

/** Tool-description text for the placeObject `position` contract shared by rooms and layouts. */
export const POSITION_CONTRACT =
  'A placeObject `position` is the min corner of the object\'s unrotated bounding box in voxels (0.5 m each). ' +
  'Whole voxels are the grid; a position may also be fractional on a ' +
  `${POSITION_QUANTUM_VOXELS}-voxel (1 mm) sub-grid so an object can sit exactly on another's surface ` +
  '(a rug on a 0.15 m floor tile at y = 0.3, a prop on a 1.0 m desk top at y = 2) or be centred in a cell ' +
  '(a 3 m desk in a 3.5 m cell at x + 0.5). Values off that sub-grid are rejected. An "extrude" may only target ' +
  'a whole-voxel placement; place each copy of a sub-grid object with its own placeObject. ';
