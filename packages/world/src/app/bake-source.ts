/**
 * Bake-source fingerprint — a hash of everything that determines a baked
 * layout GLB's content, so a stored fingerprint can be compared with a
 * freshly computed one to detect a stale bake. `bakeLayout` writes it and
 * any staleness check calls this same function.
 *
 * Headless: no `three`, no `react`, no DOM.
 */

import type { LayoutDocument } from '../scenes/layout-document.ts';
import { normalizeKind } from '../scenes/world-object-kinds-schema.ts';
import type { KindLookup } from './layout-bake-service.ts';

/** Bump when the bake algorithm itself changes output for identical inputs. */
export const BAKE_SOURCE_VERSION = 1;

/** Resolves Web Crypto's `subtle`; absent outside secure contexts (plain-HTTP browsers). */
export type SubtleProvider = () => SubtleCrypto | undefined;

const defaultSubtle: SubtleProvider = () => globalThis.crypto?.subtle;

let warnedNoSubtle = false;

/** JSON with object keys sorted at every depth; `undefined` members are dropped like `JSON.stringify`. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v) ?? 'null').join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const members = Object.keys(value)
      .sort()
      .flatMap((key) => {
        const member = canonicalJson((value as Record<string, unknown>)[key]);
        return member === undefined ? [] : [`${JSON.stringify(key)}:${member}`];
      });
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * SHA-256 hex over the layout's commands, the optimizer actually applied and
 * the catalog entries of the kinds the commands place. `groups`, `name` and
 * `updatedAt` are excluded. Kinds are normalised so a raw catalog entry and
 * its normalised form hash identically. Resolves `null` (with one
 * `console.warn`) when `crypto.subtle` is unavailable.
 */
export async function computeBakeSourceFingerprint(
  layout: LayoutDocument,
  optimizerId: string,
  kindLookup: KindLookup,
  getSubtle: SubtleProvider = defaultSubtle,
): Promise<string | null> {
  const subtle = getSubtle();
  if (!subtle) {
    if (!warnedNoSubtle) {
      warnedNoSubtle = true;
      console.warn('crypto.subtle is unavailable; baked layouts will carry no bakeSource fingerprint');
    }
    return null;
  }
  const kindIds = [
    ...new Set(layout.commands.flatMap((c) => (c.op === 'placeObject' ? [c.kindId] : []))),
  ].sort();
  const kinds = kindIds.map((id) => {
    const kind = kindLookup(id);
    return kind ? normalizeKind(kind, 0) : null;
  });
  const payload = canonicalJson({
    version: BAKE_SOURCE_VERSION,
    commands: layout.commands,
    optimizer: optimizerId,
    kinds,
  });
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
