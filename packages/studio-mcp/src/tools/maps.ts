import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deserializeMap } from '@officexr/world/scenes';
import type { StudioDocuments } from '../studio-documents.ts';
import { registerDocumentTools } from './documents.ts';

export function registerMapTools(server: McpServer, { maps, rooms }: StudioDocuments): void {
  registerDocumentTools(server, maps, {
    noun: 'map',
    description:
      'A map (schemaVersion: 2) composes rooms into a world: "rooms" are instances {id, roomName, position, rotationY} ' +
      'with integer voxel offsets and rotationY a quarter-turn count (0-3), applied to baked layouts too; ' +
      'an instance with voiceZone: true makes everyone inside the placed room share one voice + screenshare call; building: true marks it part of the main office building (its footprint bounds 2D-mode movement); "spawnPoints" use continuous ' +
      'world coordinates [x, y, z]; "environment" sets sun, sky and lighting; optional "deskAreas" are XZ world-metre rectangles ' +
      '{id, label?, min: {x, z}, max: {x, z}} that are each a voice zone; an area with more than one chair or more than one desk has no seat (ids unique, not equal to any room id). Every roomName must be an existing room.',
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
