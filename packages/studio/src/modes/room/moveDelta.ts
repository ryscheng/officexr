import type { RoomDocument } from '@officexr/world/scenes';

/**
 * Given a selection of commandIds and an integer-voxel delta, return
 * the proposed new positions for each selected object.
 * Returns null if any selected commandId is not found in doc.commands.
 */
export function computeMovedPositions(
  doc: RoomDocument,
  selectedIds: ReadonlySet<string>,
  delta: [number, number, number],
): ReadonlyMap<string, [number, number, number]> | null {
  const result = new Map<string, [number, number, number]>();

  for (const commandId of selectedIds) {
    const cmd = doc.commands.find((c) => c.id === commandId && c.op === 'placeCube');
    if (!cmd) {
      return null;
    }
    const pos = (cmd as { position: [number, number, number] }).position;
    result.set(commandId, [
      pos[0] + delta[0],
      pos[1] + delta[1],
      pos[2] + delta[2],
    ]);
  }

  return result;
}
