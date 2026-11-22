export const SILHOUETTE_OPACITY = 0.5;

export function playerAccent(playerId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < playerId.length; i++) {
    hash ^= playerId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  return `hsl(${hue}, 85%, 58%)`;
}
