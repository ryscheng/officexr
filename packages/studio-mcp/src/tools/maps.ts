import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deserializeMap } from '@officexr/world/scenes';
import type { StudioDocuments } from '../studio-documents.ts';
import { registerDocumentTools } from './documents.ts';

export function registerMapTools(server: McpServer, { maps, rooms }: StudioDocuments): void {
  registerDocumentTools(server, maps, {
    noun: 'map',
    description:
      'A map (schemaVersion: 2) composes rooms into a world: "rooms" are instances {id, roomName, position, rotationY} ' +
      'with integer voxel offsets and rotationY a quarter-turn count (0-3), applied to baked layouts too; "spawnPoints" use continuous ' +
      'world coordinates [x, y, z]; "environment" sets sun, sky and lighting. Every roomName must be an existing room.',
    beforeSave: async (doc) => {
      const known = new Set((await rooms.list()).map((r) => r.name));
      const unknown = [...new Set(deserializeMap(doc).rooms.map((r) => r.roomName))].filter(
        (roomName) => !known.has(roomName),
      );
      if (unknown.length > 0) {
        throw new Error(`map references unknown rooms: ${unknown.join(', ')}`);
      }
    },
  });
}
