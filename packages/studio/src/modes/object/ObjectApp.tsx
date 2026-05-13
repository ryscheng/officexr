import React from 'react';
import { Leva } from 'leva';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { listKinds } from '@officexr/world';

/**
 * Object editor — view + tune every non-character model in the
 * catalog. Task 5 lands the shell + a read-only kind-count summary
 * so devs can confirm the catalog (committed `cube-kinds.json` + the
 * post-install pack entries) hydrates correctly. The 3D preview +
 * per-kind Leva editor + auto-save arrive in Task 11.
 */
export function ObjectApp() {
  const kinds = listKinds();
  const byCategory = new Map<string, number>();
  for (const k of kinds) {
    byCategory.set(k.category, (byCategory.get(k.category) ?? 0) + 1);
  }
  const categoryRows = Array.from(byCategory.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      <LeftPanel>
        <div
          style={{
            padding: '12px 14px',
            font: '12px system-ui, sans-serif',
            color: '#cbd5e1',
          }}
        >
          <h2
            style={{
              margin: '0 0 8px',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Catalog — {kinds.length} kinds
          </h2>
          {categoryRows.map(([cat, count]) => (
            <div
              key={cat}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}
            >
              <span style={{ color: '#94a3b8' }}>{cat}</span>
              <span>{count}</span>
            </div>
          ))}
          <p
            style={{
              marginTop: 12,
              padding: '8px 10px',
              background: '#1e293b',
              borderRadius: 4,
              color: '#94a3b8',
              lineHeight: 1.4,
            }}
          >
            The per-kind 3D preview + material tuning panel lands in
            Task 11. Until then this page exists so the catalog
            hydration is observable.
          </p>
        </div>
      </LeftPanel>
      <main
        style={{
          flex: 1,
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          font: '14px system-ui, sans-serif',
          color: '#94a3b8',
        }}
      >
        Select a kind from the catalog to preview it.
      </main>
      <SidePanel>
        <Leva fill flat titleBar={{ drag: false }} />
      </SidePanel>
    </div>
  );
}
