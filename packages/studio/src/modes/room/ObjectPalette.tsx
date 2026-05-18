import React, { useDeferredValue, useMemo, useState } from 'react';
import {
  CUBE_KIND_CATEGORIES,
  thumbnailUrlForKind,
  type WorldObjectKind,
} from '@officexr/world/scenes';
import { useCatalog } from '@officexr/world/react';

interface ObjectPaletteProps {
  staged: string | null;
  /**
   * Pick (or unpick) a kind. The caller wires this to also flip the
   * active tool to Add — clicking a swatch is the natural "I want to
   * place this" affordance, so it should imply the tool switch
   * without a separate toolbar tap.
   */
  onStage: (kindId: string | null) => void;
}

/**
 * Groups a flat list of WorldObjectKind by category, filtering out
 * excluded categories and ordering by CUBE_KIND_CATEGORIES order.
 * Empty groups are omitted.
 *
 * Exported for unit testing.
 */
export function groupByCategory(
  kinds: readonly WorldObjectKind[],
  excludeCategories: readonly string[] = [],
): Array<{ category: string; kinds: WorldObjectKind[] }> {
  const excludeSet = new Set(excludeCategories);

  // Filter out excluded categories
  const filtered = kinds.filter((k) => !excludeSet.has(k.category));

  // Group by category
  const byCategory = new Map<string, WorldObjectKind[]>();
  for (const kind of filtered) {
    const existing = byCategory.get(kind.category);
    if (existing) {
      existing.push(kind);
    } else {
      byCategory.set(kind.category, [kind]);
    }
  }

  // Order groups by CUBE_KIND_CATEGORIES, then handle any unknown categories
  const result: Array<{ category: string; kinds: WorldObjectKind[] }> = [];
  const seenCategories = new Set<string>();

  for (const cat of CUBE_KIND_CATEGORIES) {
    const entries = byCategory.get(cat);
    if (entries && entries.length > 0) {
      result.push({ category: cat, kinds: entries });
      seenCategories.add(cat);
    }
  }

  // Append any categories not in CUBE_KIND_CATEGORIES order
  for (const [cat, entries] of byCategory.entries()) {
    if (!seenCategories.has(cat) && entries.length > 0) {
      result.push({ category: cat, kinds: entries });
    }
  }

  return result;
}

/**
 * Case-insensitive substring match against `label` and `id`. An empty
 * (or whitespace-only) query returns the input unchanged so callers
 * don't need to special-case it.
 *
 * Exported for unit testing.
 */
export function filterByName(
  kinds: readonly WorldObjectKind[],
  query: string,
): WorldObjectKind[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...kinds];
  return kinds.filter(
    (k) =>
      k.label.toLowerCase().includes(q) || k.id.toLowerCase().includes(q),
  );
}

/**
 * Left-column palette of cube kinds. Reads from the live `useCubeCatalog()`
 * so it updates when the catalog changes (e.g. after Object editor edits).
 * Groups entries by category with section headers. Shows PNG thumbnails
 * (with swatch fallback). Filters out 'character' category entries.
 *
 * A search box at the top filters kinds by case-insensitive substring
 * match on label or id. Matching is deferred so typing stays responsive
 * with the 280-kind default catalog.
 */
export function ObjectPalette({ staged, onStage }: ObjectPaletteProps) {
  const allKinds = useCatalog();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const groups = useMemo(
    () => groupByCategory(filterByName(allKinds, deferredQuery), ['character']),
    [allKinds, deferredQuery],
  );

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontSize: 11,
          color: '#a3a3a3',
          marginBottom: 4,
        }}
      >
        Objects
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter…"
        aria-label="Filter objects"
        style={{
          padding: '6px 8px',
          background: '#0f0f0f',
          color: '#fafafa',
          border: '1px solid #262626',
          borderRadius: 4,
          font: '12px system-ui, sans-serif',
          outline: 'none',
        }}
      />

      {groups.length === 0 && query.trim() !== '' ? (
        <p style={{ fontSize: 11, color: '#737373', paddingLeft: 2 }}>
          No objects match “{query}”.
        </p>
      ) : null}

      {groups.map((group) => (
        <div key={group.category}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#737373',
              marginBottom: 4,
              paddingLeft: 2,
            }}
          >
            {group.category}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {group.kinds.map((kind) => (
              <KindButton
                key={kind.id}
                kind={kind}
                isStaged={staged === kind.id}
                onStage={onStage}
              />
            ))}
          </div>
        </div>
      ))}

      <p style={{ marginTop: 12, fontSize: 11, color: '#737373', lineHeight: 1.4 }}>
        Click an item to stage it for placing. Click the floor to place.
      </p>
    </div>
  );
}

interface KindButtonProps {
  kind: WorldObjectKind;
  isStaged: boolean;
  onStage: (kindId: string | null) => void;
}

function KindButton({ kind, isStaged, onStage }: KindButtonProps) {
  const thumbnailUrl = thumbnailUrlForKind(kind.id);

  return (
    <button
      key={kind.id}
      type="button"
      onClick={() => onStage(isStaged ? null : kind.id)}
      title={kind.label}
      data-staged={isStaged ? 'true' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        background: isStaged ? '#1d4ed8' : '#1f1f1f',
        color: '#fafafa',
        border: isStaged ? '1px solid #3b82f6' : '1px solid #262626',
        borderRadius: 4,
        cursor: 'pointer',
        font: '11px system-ui, sans-serif',
      }}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          width={24}
          height={24}
          alt=""
          style={{ objectFit: 'contain', borderRadius: 2, flexShrink: 0 }}
        />
      ) : (
        <span
          style={{
            width: 14,
            height: 14,
            background: kind.swatch,
            borderRadius: 2,
            border: '1px solid rgba(255,255,255,0.2)',
            flexShrink: 0,
          }}
        />
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'left',
        }}
      >
        {kind.label}
      </span>
    </button>
  );
}
