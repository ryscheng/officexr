/**
 * TDD tests for the generalized ObjectPalette (Task 07).
 * groupByCategory pure unit tests + basic component tests.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { groupByCategory } from './ObjectPalette.tsx';
import type { CubeKindEntry } from '@officexr/world/scenes';

function makeKind(
  id: string,
  category: string,
  overrides?: Partial<CubeKindEntry>,
): CubeKindEntry {
  return {
    id,
    label: id,
    gltfPath: `/models/${id}.glb`,
    swatch: '#ff0000',
    walkable: true,
    scale: 1,
    tint: null,
    opacity: 1,
    roughness: null,
    metalness: null,
    emissive: null,
    emissiveIntensity: 0,
    category: category as CubeKindEntry['category'],
    ...overrides,
  };
}

// --- Pure unit tests for groupByCategory ---

describe('groupByCategory', () => {
  // 1. empty input
  it('returns [] for empty input', () => {
    expect(groupByCategory([])).toEqual([]);
  });

  // 2. single category
  it('single category — entries for one category return one group', () => {
    const kinds = [makeKind('a', 'block'), makeKind('b', 'block')];
    const groups = groupByCategory(kinds);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('block');
    expect(groups[0].kinds).toHaveLength(2);
  });

  // 3. multiple categories ordered
  it('multiple categories ordered: block before furniture before prototype', () => {
    const kinds = [
      makeKind('p1', 'prototype'),
      makeKind('f1', 'furniture'),
      makeKind('b1', 'block'),
    ];
    const groups = groupByCategory(kinds);
    const categoryOrder = groups.map((g) => g.category);
    expect(categoryOrder.indexOf('block')).toBeLessThan(categoryOrder.indexOf('furniture'));
    expect(categoryOrder.indexOf('furniture')).toBeLessThan(categoryOrder.indexOf('prototype'));
  });

  // 4. excludes character
  it('excludes entries with category: "character"', () => {
    const kinds = [
      makeKind('b1', 'block'),
      makeKind('c1', 'character' as any),
    ];
    const groups = groupByCategory(kinds, ['character']);
    const allKinds = groups.flatMap((g) => g.kinds);
    expect(allKinds.find((k) => k.id === 'c1')).toBeUndefined();
    expect(allKinds.find((k) => k.id === 'b1')).toBeDefined();
  });

  // 5. empty category omitted
  it('empty category omitted — if all entries excluded, category section gone', () => {
    const kinds = [makeKind('c1', 'character' as any)];
    const groups = groupByCategory(kinds, ['character']);
    expect(groups).toHaveLength(0);
  });

  // 6. preserves all entries
  it('sum of all group sizes equals input size minus excluded', () => {
    const kinds = [
      makeKind('b1', 'block'),
      makeKind('b2', 'block'),
      makeKind('f1', 'furniture'),
      makeKind('c1', 'character' as any),
    ];
    const groups = groupByCategory(kinds, ['character']);
    const total = groups.reduce((sum, g) => sum + g.kinds.length, 0);
    expect(total).toBe(3); // 4 minus 1 excluded
  });
});

// --- Component tests (mocking useCubeCatalog) ---

// We need to mock the catalog since in test environment there's no fetch
vi.mock('@officexr/world/scenes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@officexr/world/scenes')>();
  return {
    ...actual,
    useCubeCatalog: () => [
      makeKind('block-grass', 'block', { label: 'Grass' }),
      makeKind('furniture-chair', 'furniture', { label: 'Chair' }),
    ],
    thumbnailUrlForKind: () => null,
    CUBE_KIND_CATEGORIES: ['block', 'furniture', 'prototype', 'restaurant'],
  };
});

// Import AFTER the mock is registered
const { ObjectPalette } = await import('./ObjectPalette.tsx');

describe('ObjectPalette component', () => {
  // 7. renders category headers
  it('renders category headers for block and furniture', () => {
    const { container } = render(
      <ObjectPalette staged={null} onStage={() => {}} />,
    );
    expect(container.textContent).toContain('block');
    expect(container.textContent).toContain('furniture');
  });

  // 8. kind button renders
  it('kind label text is visible in the DOM', () => {
    const { container } = render(
      <ObjectPalette staged={null} onStage={() => {}} />,
    );
    expect(container.textContent).toContain('Grass');
    expect(container.textContent).toContain('Chair');
  });

  // 9. click stages kind
  it('clicking a button calls onStage with the correct kind id', () => {
    const onStage = vi.fn();
    const { container } = render(
      <ObjectPalette staged={null} onStage={onStage} />,
    );
    const buttons = container.querySelectorAll('button');
    const grassBtn = Array.from(buttons).find((b) => b.textContent?.includes('Grass'));
    fireEvent.click(grassBtn!);
    expect(onStage).toHaveBeenCalledWith('block-grass');
  });

  // 10. active state
  it('button for the staged kindId has highlighted appearance (data-staged="true")', () => {
    const { container } = render(
      <ObjectPalette staged="block-grass" onStage={() => {}} />,
    );
    const buttons = container.querySelectorAll('button');
    const grassBtn = Array.from(buttons).find((b) => b.textContent?.includes('Grass'));
    expect(grassBtn?.getAttribute('data-staged')).toBe('true');
  });
});
