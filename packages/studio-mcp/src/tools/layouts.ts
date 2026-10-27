import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deserializeLayout } from '@officexr/world/scenes';
import type { StudioDocuments } from '../studio-documents.ts';
import { registerDocumentTools } from './documents.ts';
import { rejectDisallowedYaws, YAW_CONTRACT } from './yaw.ts';

export function registerLayoutTools(server: McpServer, { layouts, catalog }: StudioDocuments): void {
  registerDocumentTools(server, layouts, {
    noun: 'layout',
    description:
      'A layout is a command list for static structural geometry (walls, floors) in integer voxel ' +
      'coordinates [x, y, z], the same commands as a room. It is the source that gets baked into one optimized model. ' +
      YAW_CONTRACT +
      " Baked layout GLBs don't apply yawDeg yet.",
    beforeSave: rejectDisallowedYaws(catalog, deserializeLayout),
  });
}
