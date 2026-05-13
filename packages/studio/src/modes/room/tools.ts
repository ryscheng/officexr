/**
 * Editor tool kinds. The active tool determines what a left-click in
 * the canvas does:
 *
 *   - **select**: persistent default. Click an existing cube to
 *     select it (so the inspector shows its parameters). Click on
 *     empty floor does nothing. Selection drives the inspector and
 *     the extrude-face buttons there.
 *   - **add**: single-shot. The next left-click on the floor places
 *     a `placeCube` command of the staged kind, then the tool
 *     reverts to `select`. Clicking on an existing cube while in
 *     `add` is a no-op (we don't stack cubes via clicks).
 *
 * Other tools (rotate, mirror, fill) can be added here without
 * changing the canvas's pointer-handling shape — the canvas only
 * cares about the active tool's left-click semantics.
 */
export type Tool = 'select' | 'add';

export const TOOLS: ReadonlyArray<{
  tool: Tool;
  label: string;
  description: string;
}> = [
  { tool: 'select', label: 'Select', description: 'Click to select a cube (default)' },
  { tool: 'add', label: 'Add', description: 'Click to place the staged cube; reverts to Select' },
];
