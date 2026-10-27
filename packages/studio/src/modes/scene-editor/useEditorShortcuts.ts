import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { nextAllowedYaw } from '@officexr/world/scenes';
import { useApplication } from '@officexr/world/react';
import { selectionIsExactlyOneGroup } from '../room/room-selection.ts';
import type { Tool } from './tools.ts';

/** The document operations the editor shortcuts drive. */
export interface ShortcutDoc {
  selection: ReadonlySet<string>;
  lookup: { groupMembers: ReadonlyMap<string, readonly string[]> };
  clearSelection(): void;
  groupCommands(commandIds: Iterable<string>): unknown;
  ungroupCommands(groupId: string): void;
  undo(): void;
  redo(): void;
  deleteSelection(): void;
  rotateSelection(): void;
}

interface EditorShortcutsOptions {
  doc: ShortcutDoc;
  tool: Tool;
  stagedKindId: string | null;
  setTool: (tool: Tool) => void;
  setBuildHeight: Dispatch<SetStateAction<number>>;
  setStagedYawDeg: Dispatch<SetStateAction<number>>;
}

/**
 * Window keydown shortcuts shared by the Room and Layout editors:
 * Esc, Ctrl/Cmd+G / Shift+G / Z / Shift+Z / Y, Delete/Backspace,
 * Q/E (build height), R (rotate), and the V/B/X/T/M tool keys.
 * Keys typed into an INPUT or TEXTAREA are ignored.
 */
export function useEditorShortcuts({
  doc,
  tool,
  stagedKindId,
  setTool,
  setBuildHeight,
  setStagedYawDeg,
}: EditorShortcutsOptions): void {
  const { catalog } = useApplication();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'Escape') {
        setTool('select');
        doc.clearSelection();
        return;
      }
      // Ctrl/Cmd shortcuts first — they overlap with the bare letters below.
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        // Shift variants must be checked before their plain counterparts.
        if (k === 'g' && e.shiftKey) {
          e.preventDefault();
          const exact = selectionIsExactlyOneGroup(doc.selection, doc.lookup.groupMembers);
          if (exact) {
            doc.ungroupCommands(exact);
          }
        } else if (k === 'g') {
          e.preventDefault();
          if (doc.selection.size >= 2) {
            doc.groupCommands(doc.selection);
          }
        } else if (k === 'z' && e.shiftKey) {
          e.preventDefault();
          doc.redo();
        } else if (k === 'z') {
          e.preventDefault();
          doc.undo();
        } else if (k === 'y' && !e.metaKey) {
          // Ctrl+Y is the Windows redo; Cmd+Y means nothing on a Mac.
          e.preventDefault();
          doc.redo();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (doc.selection.size > 0) {
          e.preventDefault();
          doc.deleteSelection();
        }
        return;
      }
      if (e.altKey || e.shiftKey) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'q') {
        setBuildHeight((y) => y - 1);
      } else if (k === 'e') {
        setBuildHeight((y) => y + 1);
      } else if (k === 'r') {
        // Add keeps the object it just placed selected, so the staged
        // object must win over the selection while Add is active.
        if (tool === 'add' && stagedKindId) {
          const kind = catalog.getKind(stagedKindId);
          setStagedYawDeg((yaw) => nextAllowedYaw(kind, yaw));
        } else if (doc.selection.size > 0) {
          doc.rotateSelection();
        }
      } else if (k === 'v') {
        setTool('select');
      } else if (k === 'b') {
        // Add and Tile have nothing to place without a staged kind.
        if (stagedKindId) {
          setTool('add');
        }
      } else if (k === 'x') {
        setTool('delete');
      } else if (k === 't') {
        if (stagedKindId) {
          setTool('tile');
        }
      } else if (k === 'm') {
        setTool('move');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, tool, stagedKindId, catalog, setTool, setBuildHeight, setStagedYawDeg]);
}
