/**
 * blocking.ts — shared, headless blocking-decision helpers.
 *
 * DIP: this module lives in the physics layer. It has no Three, no React,
 * no r3f imports. Both the headless bot path (BotPhysicsWorld) and the
 * r3f-hosted human path (SceneFrame) depend on this module — not the
 * reverse.
 *
 * SRP: this module owns ONE thing — "how much of the intended horizontal
 * motion actually happened, as a clamped [0,1] scalar". Everything else
 * (gravity integration, position application, animation derivation) is
 * the caller's concern.
 */

/**
 * Compute how much of the intended horizontal motion was actually achieved
 * after the Rapier character controller resolved collisions.
 *
 * Uses the directional dot-product formula so that backward slides (e.g.
 * a sphere surface deflecting the character opposite to its intent at
 * head-on contact) correctly return 0 instead of a spuriously positive
 * magnitude ratio.
 *
 * Contract:
 *   - Returns 1.0  when the corrected vector is exactly the intent.
 *   - Returns 0.0  when no motion, or when corrected is orthogonal/opposite
 *                  to intent (blocked or deflected backward).
 *   - Returns ]0,1[ for a partial forward slide (wall at an angle).
 *   - When intent is the zero vector (intentLenSq ≤ 1e-12), returns 1 to
 *     signal "no blocking decision needed" so callers don't treat a
 *     stationary frame as blocked.
 *
 * @param corrected - The horizontal (x,z) displacement after KCC resolution.
 * @param intent    - The horizontal (x,z) displacement that was requested.
 * @returns A value in [0, 1].
 */
export function horizontalProgress(
  corrected: { x: number; z: number },
  intent: { x: number; z: number },
): number {
  const intentLenSq = intent.x * intent.x + intent.z * intent.z;
  if (intentLenSq <= 1e-12) {
    // No horizontal intent this frame — not a blocking scenario.
    return 1;
  }
  const dot = corrected.x * intent.x + corrected.z * intent.z;
  return Math.max(0, Math.min(1, dot / intentLenSq));
}
