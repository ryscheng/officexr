import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deserializeScene } from '@officexr/world/scenes';
import type { StudioDocuments } from '../studio-documents.ts';
import { registerDocumentTools } from './documents.ts';
import { POSITION_CONTRACT } from './positions.ts';
import { rejectDisallowedYaws, YAW_CONTRACT } from './yaw.ts';

export function registerRoomTools(server: McpServer, { rooms, catalog }: StudioDocuments): void {
  registerDocumentTools(server, rooms, {
    noun: 'room',
    description:
      'A room is an ordered command list ("placeObject" places one world object by kindId; "extrude" ' +
      'repeats an existing object along a face) in voxel coordinates [x, y, z]. ' +
      POSITION_CONTRACT +
      'Maps place rooms by name. ' +
      YAW_CONTRACT,
    beforeSave: rejectDisallowedYaws(catalog, deserializeScene),
  });
}
