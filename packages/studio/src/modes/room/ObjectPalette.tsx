import React from 'react';
import {
  useCubeCatalog,
  CUBE_KIND_CATEGORIES,
  thumbnailUrlForKind,
  type CubeKindEntry,
} from '@officexr/world/scenes';

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
 * Groups a flat list of CubeKindEntry by category, filtering out
 * excluded categories and ordering by CUBE_KIND_CATEGORIES order.
 * Empty groups are omitted.
 *
 * Exported for unit testing.
 */
export function groupByCategory(
  kinds: readonly CubeKindEntry[],
  excludeCategories: readonly string[] = [],
): Array<{ category: string; kinds: CubeKindEntry[] }> {
  const excludeSet = new Set(excludeCategories);

  // Filter out excluded categories
  const filtered = kinds.filter((k) => !excludeSet.has(k.category));

  // Group by category
  const byCategory = new Map<string, CubeKindEntry[]>();
  for (const kind of filtered) {
    const existing = byCategory.get(kind.category);
    if (existing) {
      existing.push(kind);
    } else {
      byCategory.set(kind.category, [kind]);
    }
  }

  // Order groups by CUBE_KIND_CATEGORIES, then handle any unknown categories
  const result: Array<{ category: string; kinds: CubeKindEntry[] }> = [];
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
 * Left-column palette of cube kinds. Reads from the live `useCubeCatalog()`
 * so it updates when the catalog changes (e.g. after Object editor edits).
 * Groups entries by category with section headers. Shows PNG thumbnails
 * (with swatch fallback). Filters out 'character' category entries.
 */
export function ObjectPalette({ staged, onStage }: ObjectPaletteProps) {
  const allKinds = useCubeCatalog();
  const groups = groupByCategory(allKinds, ['character']);

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
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 6,
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
  kind: CubeKindEntry;
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
          width={48}
          height={48}
          alt={kind.label}
          style={{ objectFit: 'contain', borderRadius: 2 }}
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
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {kind.label}
      </span>
    </button>
  );
}
