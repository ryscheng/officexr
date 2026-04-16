import { useState } from 'react';
import { InventoryItem, RARITY_CONFIG, Rarity } from '@/data/lootBoxItems';

interface InventoryPanelProps {
  visible: boolean;
  onClose: () => void;
  inventory: InventoryItem[];
  onDiscard: (instanceId: string) => void;
}

type FilterRarity = 'all' | Rarity;

export default function InventoryPanel({ visible, onClose, inventory, onDiscard }: InventoryPanelProps) {
  const [filter, setFilter] = useState<FilterRarity>('all');
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  if (!visible) return null;

  const filtered = filter === 'all'
    ? inventory
    : inventory.filter(i => i.rarity === filter);

  // Count by rarity
  const counts = new Map<Rarity, number>();
  for (const item of inventory) {
    counts.set(item.rarity, (counts.get(item.rarity) ?? 0) + 1);
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 510,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        background: 'rgba(15,15,25,0.95)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '16px',
        width: '700px', maxWidth: '95vw',
        maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div>
            <h2 style={{
              color: 'white', fontSize: '20px', fontWeight: 'bold',
              margin: 0, fontFamily: 'monospace',
            }}>
              Inventory
            </h2>
            <span style={{
              color: 'rgba(255,255,255,0.4)', fontSize: '12px', fontFamily: 'monospace',
            }}>
              {inventory.length} item{inventory.length !== 1 ? 's' : ''} collected
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px', color: 'white', fontSize: '16px',
              width: '32px', height: '32px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >x</button>
        </div>

        {/* Filter bar */}
        <div style={{
          display: 'flex', gap: '6px', padding: '12px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          flexWrap: 'wrap',
        }}>
          <FilterButton
            label={`All (${inventory.length})`}
            active={filter === 'all'}
            color="rgba(255,255,255,0.6)"
            onClick={() => setFilter('all')}
          />
          {(Object.entries(RARITY_CONFIG) as [Rarity, typeof RARITY_CONFIG[Rarity]][]).map(([rarity, config]) => (
            <FilterButton
              key={rarity}
              label={`${config.label} (${counts.get(rarity) ?? 0})`}
              active={filter === rarity}
              color={config.color}
              onClick={() => setFilter(rarity)}
            />
          ))}
        </div>

        {/* Items grid */}
        <div style={{
          flex: 1, overflow: 'auto', padding: '16px 20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: '10px',
        }}>
          {filtered.length === 0 && (
            <div style={{
              gridColumn: '1 / -1',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '40px', color: 'rgba(255,255,255,0.3)',
              fontFamily: 'monospace', fontSize: '14px',
            }}>
              <span style={{ fontSize: '40px', marginBottom: '8px' }}>📦</span>
              {inventory.length === 0
                ? 'No items yet. Open some boxes!'
                : 'No items in this category'}
            </div>
          )}
          {filtered.map(item => (
            <ItemCard
              key={item.instanceId}
              item={item}
              isConfirming={confirmDiscard === item.instanceId}
              onDiscardClick={() => setConfirmDiscard(item.instanceId)}
              onConfirmDiscard={() => {
                onDiscard(item.instanceId);
                setConfirmDiscard(null);
              }}
              onCancelDiscard={() => setConfirmDiscard(null)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Filter button ──────────────────────────────────────────────────────────

function FilterButton({ label, active, color, onClick }: {
  label: string; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? `${color}22` : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
        borderRadius: '6px',
        color: active ? color : 'rgba(255,255,255,0.4)',
        fontSize: '11px', fontFamily: 'monospace',
        padding: '4px 10px', cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >{label}</button>
  );
}

// ─── Item card ──────────────────────────────────────────────────────────────

function ItemCard({ item, isConfirming, onDiscardClick, onConfirmDiscard, onCancelDiscard }: {
  item: InventoryItem;
  isConfirming: boolean;
  onDiscardClick: () => void;
  onConfirmDiscard: () => void;
  onCancelDiscard: () => void;
}) {
  const config = RARITY_CONFIG[item.rarity];
  const date = new Date(item.obtainedAt);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

  return (
    <div style={{
      background: config.bgGradient,
      border: `1px solid ${config.color}33`,
      borderRadius: '10px',
      padding: '12px',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: '6px',
      position: 'relative',
      transition: 'border-color 0.2s, box-shadow 0.2s',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = `${config.color}66`;
        e.currentTarget.style.boxShadow = `0 0 12px ${config.glowColor}`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = `${config.color}33`;
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <span style={{ fontSize: '28px', lineHeight: 1 }}>{item.emoji}</span>
      <span style={{
        color: config.color, fontSize: '11px', fontWeight: 'bold',
        fontFamily: 'monospace', textAlign: 'center',
        lineHeight: 1.2,
      }}>{item.name}</span>
      <span style={{
        color: 'rgba(255,255,255,0.4)', fontSize: '9px',
        fontFamily: 'monospace', fontStyle: 'italic',
        textAlign: 'center', lineHeight: 1.3,
        maxHeight: '24px', overflow: 'hidden',
      }}>{item.description}</span>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', marginTop: '2px',
      }}>
        <span style={{
          color: config.color, fontSize: '9px', fontFamily: 'monospace',
          opacity: 0.6,
        }}>{config.label}</span>
        <span style={{
          color: 'rgba(255,255,255,0.2)', fontSize: '9px', fontFamily: 'monospace',
        }}>{dateStr}</span>
      </div>

      {/* Discard button / confirm */}
      {isConfirming ? (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.85)',
          borderRadius: '10px',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '8px',
        }}>
          <span style={{ color: '#f87171', fontSize: '11px', fontFamily: 'monospace' }}>Discard?</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={onConfirmDiscard}
              style={{
                background: '#dc2626', border: 'none', borderRadius: '4px',
                color: 'white', fontSize: '10px', padding: '3px 10px',
                cursor: 'pointer', fontFamily: 'monospace',
              }}
            >Yes</button>
            <button
              onClick={onCancelDiscard}
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '4px',
                color: 'white', fontSize: '10px', padding: '3px 10px',
                cursor: 'pointer', fontFamily: 'monospace',
              }}
            >No</button>
          </div>
        </div>
      ) : (
        <button
          onClick={onDiscardClick}
          style={{
            position: 'absolute', top: '4px', right: '4px',
            background: 'rgba(255,255,255,0.05)',
            border: 'none', borderRadius: '4px',
            color: 'rgba(255,255,255,0.2)', fontSize: '10px',
            width: '18px', height: '18px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: 0,
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '0'; }}
          title="Discard item"
        >x</button>
      )}
    </div>
  );
}
