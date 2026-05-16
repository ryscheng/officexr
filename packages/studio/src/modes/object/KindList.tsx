import React, { useMemo, useState } from 'react';
import {
  CUBE_KIND_CATEGORIES,
  type CubeKindCategory,
  type CubeKindEntry,
} from '@officexr/world';

interface KindListProps {
  kinds: readonly CubeKindEntry[];
  selectedKindId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Left-panel kind picker. Kinds are grouped by `category` (block,
 * furniture, prototype, restaurant) with collapsible sections. Each
 * row shows a swatch chip + label + a small walkable badge if the
 * kind is walkable. A filter input narrows the visible kinds by
 * substring match against the id or label.
 *
 * Designed to handle the 281-entry post-`asset-packs:install`
 * catalog without scrolling becoming painful: collapse the sections
 * the user isn't browsing.
 */
export function KindList({ kinds, selectedKindId, onSelect }: KindListProps) {
  const [filter, setFilter] = useState<string>('');
  const [collapsed, setCollapsed] = useState<Set<CubeKindCategory>>(
    () => new Set(['prototype', 'restaurant']),
  );

  const byCategory = useMemo(() => {
    const m = new Map<CubeKindCategory, CubeKindEntry[]>();
    for (const cat of CUBE_KIND_CATEGORIES) m.set(cat, []);
    const q = filter.trim().toLowerCase();
    for (const k of kinds) {
      if (q && !k.id.toLowerCase().includes(q) && !k.label.toLowerCase().includes(q)) {
        continue;
      }
      m.get(k.category)?.push(k);
    }
    return m;
  }, [kinds, filter]);

  const toggleCategory = (cat: CubeKindCategory) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        font: '12px system-ui, sans-serif',
        color: '#cbd5e1',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #262626',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontSize: 10,
            color: '#94a3b8',
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          Catalog ({kinds.length} kinds)
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          style={{
            width: '100%',
            padding: '4px 6px',
            fontSize: 12,
            background: '#0a0a0a',
            border: '1px solid #404040',
            borderRadius: 3,
            color: '#fafafa',
          }}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {CUBE_KIND_CATEGORIES.map((cat) => {
          const entries = byCategory.get(cat) ?? [];
          if (entries.length === 0) return null;
          const isCollapsed = collapsed.has(cat);
          return (
            <div key={cat}>
              <button
                type="button"
                onClick={() => toggleCategory(cat)}
                style={{
                  width: '100%',
                  padding: '6px 12px',
                  textAlign: 'left',
                  background: '#0f172a',
                  border: 0,
                  borderTop: '1px solid #1e293b',
                  borderBottom: '1px solid #1e293b',
                  color: '#cbd5e1',
                  font: 'inherit',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>
                  {cat}
                </span>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>
                  {entries.length}
                  {isCollapsed ? ' ▸' : ' ▾'}
                </span>
              </button>
              {!isCollapsed &&
                entries.map((k) => (
                  <KindRow
                    key={k.id}
                    kind={k}
                    selected={k.id === selectedKindId}
                    onSelect={() => onSelect(k.id)}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KindRow({
  kind,
  selected,
  onSelect,
}: {
  kind: CubeKindEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  // Tint preview swatch with the user's tint override when set so the
  // sidebar shows what the cube will look like in the scene.
  const swatch = kind.tint ?? kind.swatch;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={kind.id}
      data-kind-id={kind.id}
      style={{
        width: '100%',
        padding: '4px 12px',
        textAlign: 'left',
        background: selected ? '#1d4ed8' : 'transparent',
        border: 0,
        color: '#fafafa',
        font: 'inherit',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        overflow: 'hidden',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          background: swatch,
          borderRadius: 3,
          border: '1px solid #00000040',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {kind.label}
      </span>
      {kind.walkable && (
        <span
          title="Walkable"
          style={{
            fontSize: 10,
            padding: '0 4px',
            background: '#374151',
            color: '#e5e7eb',
            borderRadius: 2,
          }}
        >
          walk
        </span>
      )}
    </button>
  );
}
