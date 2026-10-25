import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StudioDocuments } from '../studio-documents.ts';
import { registerDocumentTools } from './documents.ts';

export function registerRoomTools(server: McpServer, { rooms }: StudioDocuments): void {
  registerDocumentTools(server, rooms, {
    noun: 'room',
    description:
      'A room is an ordered command list ("placeObject" places one world object by kindId; "extrude" ' +
      'repeats an existing object along a face) in integer voxel coordinates [x, y, z]. ' +
      'Maps place rooms by name.',
  });
}
