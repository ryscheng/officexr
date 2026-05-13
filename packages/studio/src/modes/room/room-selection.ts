/**
 * Pure helpers for the Room editor's selection model. Extracted so
 * the click-semantic rules are unit-testable without a DOM.
 *
 * The Room editor's selection is a `ReadonlySet<commandId>`. Plain
 * click replaces it; Ctrl/Cmd+click toggles. Clicking a member of a
 * group selects the WHOLE group atomically — groups are a v1
 * lifecycle concern, individual cubes in a group can't be hand-picked
 * away without ungrouping first.
 */

/** Lookup contract the helpers need. The Room editor passes its
 * derived `commandToGroup` + `groupMembers` indexes; tests supply a
 * static fake. */
export interface GroupLookup {
  /** Returns the groupId the command belongs to, or null if it's
   * not in any group. */
  groupOf(commandId: string): string | null;
  /** Returns the full member list of a group. Order doesn't matter
   * (selection is a Set). Empty when the groupId is unknown. */
  groupMembers(groupId: string): readonly string[];
}

/** Expand a single command into the atomic select-set: itself OR
 * every member of its group. */
export function atomicSelectionFor(
  commandId: string,
  lookup: GroupLookup,
): readonly string[] {
  const g = lookup.groupOf(commandId);
  if (!g) return [commandId];
  const members = lookup.groupMembers(g);
  return members.length > 0 ? members : [commandId];
}

/** Plain click semantic: replace whatever was selected with the
 * atomic select-set for the clicked command. */
export function selectionFromClick(
  commandId: string,
  lookup: GroupLookup,
): Set<string> {
  return new Set(atomicSelectionFor(commandId, lookup));
}

/** Ctrl/Cmd+click semantic: toggle the atomic select-set in/out of
 * the current selection. If ALL members of the atomic set are already
 * selected, remove them all; otherwise add them all. */
export function selectionFromToggle(
  current: ReadonlySet<string>,
  commandId: string,
  lookup: GroupLookup,
): Set<string> {
  const atomic = atomicSelectionFor(commandId, lookup);
  const allSelected = atomic.every((id) => current.has(id));
  const next = new Set(current);
  if (allSelected) {
    for (const id of atomic) next.delete(id);
  } else {
    for (const id of atomic) next.add(id);
  }
  return next;
}

/** True iff the current selection is EXACTLY the membership of some
 * group (used by the context menu to show "Ungroup"). Tolerates
 * iteration order — compares as sets. */
export function selectionIsExactlyOneGroup(
  selection: ReadonlySet<string>,
  groups: ReadonlyMap<string, readonly string[]>,
): string | null {
  if (selection.size === 0) return null;
  for (const [groupId, members] of groups) {
    if (members.length !== selection.size) continue;
    let match = true;
    for (const m of members) {
      if (!selection.has(m)) {
        match = false;
        break;
      }
    }
    if (match) return groupId;
  }
  return null;
}
