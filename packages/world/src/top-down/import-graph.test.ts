import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = /^(three($|\/)|@react-three\/)/;
// Type-only imports and re-exports are erased at build time, so they can't pull code in.
const VALUE_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

/** Every value-level specifier reachable from `entry`, following relative imports only. */
function walk(entry: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) {
      continue;
    }
    files.add(file);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(VALUE_IMPORT)) {
      if (!spec.startsWith('.')) {
        bare.add(spec);
        continue;
      }
      const target = resolve(dirname(file), spec);
      if (!existsSync(target)) {
        throw new Error(`unresolved import ${spec} in ${file}`);
      }
      queue.push(target);
    }
  }
  return { files, bare };
}

describe('@officexr/world/top-down import graph', () => {
  const { files, bare } = walk(resolve(dirname(fileURLToPath(import.meta.url)), 'index.ts'));

  it('reaches neither three nor @react-three/*', () => {
    expect([...bare].filter((s) => FORBIDDEN.test(s))).toEqual([]);
  });

  it('does not reach Scene.tsx', () => {
    expect([...files].filter((f) => f.endsWith('/Scene.tsx'))).toEqual([]);
  });
});
