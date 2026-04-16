import { useEffect, useRef, useState, useCallback } from 'react';
import { LootItem, RARITY_CONFIG, Rarity } from '@/data/lootBoxItems';

// ─── CSGO-style spinning loot box ───────────────────────────────────────────

interface LootBoxProps {
  /** Whether the panel is visible */
  visible: boolean;
  onClose: () => void;
  /** null = idle, array = currently spinning */
  spinStrip: LootItem[] | null;
  wonItem: LootItem | null;
  isSpinning: boolean;
  cooldownRemaining: number;
  onOpenBox: () => boolean;
  onFinalizeSpin: () => void;
  onDismissResult: () => void;
  onShowInventory: () => void;
  inventoryCount: number;
}

const ITEM_WIDTH = 120;
const LANDING_INDEX = 45;
const STRIP_VISIBLE_ITEMS = 7;
const VIEWPORT_WIDTH = STRIP_VISIBLE_ITEMS * ITEM_WIDTH;

// Confetti particle for celebrations
interface ConfettiPiece {
  id: number;
  x: number;
  y: number;
  rotation: number;
  color: string;
  size: number;
  vx: number;
  vy: number;
  vr: number;
}

export default function LootBox({
  visible,
  onClose,
  spinStrip,
  wonItem,
  isSpinning,
  cooldownRemaining,
  onOpenBox,
  onFinalizeSpin,
  onDismissResult,
  onShowInventory,
  inventoryCount,
}: LootBoxProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [showResult, setShowResult] = useState(false);
  const [confetti, setConfetti] = useState<ConfettiPiece[]>([]);
  const confettiIdRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);

  // Start spin animation when spinStrip changes
  useEffect(() => {
    if (!spinStrip || !isSpinning || !stripRef.current) return;

    setShowResult(false);
    const strip = stripRef.current;

    // Calculate final position: center the landing item in the viewport
    // Add a small random offset within the item for visual interest
    const randomOffset = (Math.random() - 0.5) * (ITEM_WIDTH * 0.6);
    const targetOffset = LANDING_INDEX * ITEM_WIDTH - (VIEWPORT_WIDTH / 2) + (ITEM_WIDTH / 2) + randomOffset;

    // Reset position
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0px)';

    // Force reflow
    void strip.offsetHeight;

    // Start the spin with a cubic-bezier easing (fast start, slow deceleration like CSGO)
    strip.style.transition = 'transform 5.5s cubic-bezier(0.15, 0.85, 0.25, 1)';
    strip.style.transform = `translateX(-${targetOffset}px)`;

    const timer = setTimeout(() => {
      onFinalizeSpin();
      setShowResult(true);

      // Confetti for rare+ items
      if (wonItem && RARITY_CONFIG[wonItem.rarity].confetti) {
        spawnConfettiCelebration(wonItem.rarity);
      }
    }, 5700);

    return () => clearTimeout(timer);
  }, [spinStrip, isSpinning]);

  // Animate confetti
  useEffect(() => {
    if (confetti.length === 0) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const animate = () => {
      setConfetti(prev => {
        const next = prev
          .map(p => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            vy: p.vy + 0.3, // gravity
            rotation: p.rotation + p.vr,
          }))
          .filter(p => p.y < 800); // remove when off screen
        return next;
      });
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [confetti.length > 0]);

  const spawnConfettiCelebration = useCallback((rarity: Rarity) => {
    const color = RARITY_CONFIG[rarity].color;
    const colors = [color, '#ffffff', '#ffd700', color, '#ff69b4'];
    const pieces: ConfettiPiece[] = [];
    for (let i = 0; i < 60; i++) {
      pieces.push({
        id: confettiIdRef.current++,
        x: VIEWPORT_WIDTH / 2 + (Math.random() - 0.5) * 200,
        y: 150 + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 360,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.random() * 8,
        vx: (Math.random() - 0.5) * 16,
        vy: -(4 + Math.random() * 10),
        vr: (Math.random() - 0.5) * 20,
      });
    }
    setConfetti(pieces);
  }, []);

  const handleOpen = () => {
    if (isSpinning || (wonItem && showResult)) return;
    onDismissResult();
    onOpenBox();
  };

  const handleDismiss = () => {
    setShowResult(false);
    setConfetti([]);
    onDismissResult();
  };

  if (!visible) return null;

  const cooldownSec = Math.ceil(cooldownRemaining / 1000);
  const canOpen = cooldownRemaining <= 0 && !isSpinning && !showResult;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(8px)',
    }}>
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: '16px', right: '16px',
          background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '8px', color: 'white', fontSize: '18px',
          width: '36px', height: '36px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >x</button>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '20px', maxWidth: '900px', width: '100%', padding: '0 20px',
      }}>
        {/* Title */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{
            color: 'white', fontSize: '28px', fontWeight: 'bold',
            margin: '0 0 4px 0', fontFamily: 'monospace',
            textShadow: '0 0 20px rgba(139,92,246,0.5)',
          }}>
            AI Loot Box
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', margin: 0, fontFamily: 'monospace' }}>
            Collect AI models, tools, papers & breakthrough concepts
          </p>
        </div>

        {/* Spinning strip container */}
        <div style={{
          position: 'relative',
          width: `${VIEWPORT_WIDTH}px`, maxWidth: '100%',
          height: '160px',
          overflow: 'hidden',
          borderRadius: '12px',
          border: '2px solid rgba(255,255,255,0.15)',
          background: 'rgba(0,0,0,0.5)',
        }}>
          {/* Center marker (the "needle") */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: '50%', transform: 'translateX(-50%)',
            width: '3px', background: '#ffd700',
            zIndex: 10, boxShadow: '0 0 12px rgba(255,215,0,0.8)',
          }} />
          {/* Top/bottom triangle markers */}
          <div style={{
            position: 'absolute', top: '-2px', left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0, zIndex: 10,
            borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
            borderTop: '10px solid #ffd700',
            filter: 'drop-shadow(0 0 4px rgba(255,215,0,0.8))',
          }} />
          <div style={{
            position: 'absolute', bottom: '-2px', left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0, zIndex: 10,
            borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
            borderBottom: '10px solid #ffd700',
            filter: 'drop-shadow(0 0 4px rgba(255,215,0,0.8))',
          }} />

          {/* Strip of items */}
          {spinStrip && (
            <div
              ref={stripRef}
              style={{
                display: 'flex', position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translateX(0px) translateY(-50%)',
                willChange: 'transform',
              }}
            >
              {spinStrip.map((item, idx) => (
                <SpinItem key={idx} item={item} />
              ))}
            </div>
          )}

          {/* Idle state — no strip yet */}
          {!spinStrip && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'repeating-linear-gradient(45deg, rgba(139,92,246,0.05), rgba(139,92,246,0.05) 10px, transparent 10px, transparent 20px)',
            }}>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '48px' }}>📦</span>
            </div>
          )}

          {/* Confetti overlay */}
          {confetti.length > 0 && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
              {confetti.map(p => (
                <div key={p.id} style={{
                  position: 'absolute',
                  left: `${p.x}px`, top: `${p.y}px`,
                  width: `${p.size}px`, height: `${p.size}px`,
                  background: p.color,
                  borderRadius: p.size > 6 ? '2px' : '50%',
                  transform: `rotate(${p.rotation}deg)`,
                }} />
              ))}
            </div>
          )}
        </div>

        {/* Result display */}
        {showResult && wonItem && (
          <ResultCard item={wonItem} onDismiss={handleDismiss} />
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={handleOpen}
            disabled={!canOpen}
            style={{
              background: canOpen
                ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)'
                : 'rgba(255,255,255,0.08)',
              color: canOpen ? 'white' : 'rgba(255,255,255,0.3)',
              border: canOpen ? '2px solid #a78bfa' : '2px solid rgba(255,255,255,0.1)',
              borderRadius: '12px',
              padding: '12px 32px',
              fontSize: '16px', fontWeight: 'bold', fontFamily: 'monospace',
              cursor: canOpen ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              boxShadow: canOpen ? '0 0 20px rgba(139,92,246,0.4)' : 'none',
            }}
          >
            {isSpinning ? 'Opening...' :
             showResult ? 'Claimed!' :
             cooldownRemaining > 0 ? `Wait ${cooldownSec}s` :
             'Open Box'}
          </button>

          <button
            onClick={onShowInventory}
            style={{
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '12px',
              padding: '12px 20px',
              fontSize: '14px', fontFamily: 'monospace',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Inventory ({inventoryCount})
          </button>
        </div>

        {/* Rarity legend */}
        <div style={{
          display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center',
        }}>
          {(Object.entries(RARITY_CONFIG) as [Rarity, typeof RARITY_CONFIG[Rarity]][]).map(([rarity, config]) => (
            <span key={rarity} style={{
              color: config.color, fontSize: '11px', fontFamily: 'monospace',
              opacity: 0.7,
            }}>
              {config.label} ({config.weight}%)
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Individual item in the spinning strip ──────────────────────────────────

function SpinItem({ item }: { item: LootItem }) {
  const config = RARITY_CONFIG[item.rarity];
  return (
    <div style={{
      width: `${ITEM_WIDTH}px`, minWidth: `${ITEM_WIDTH}px`,
      height: '140px',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '4px',
      background: config.bgGradient,
      borderRight: '1px solid rgba(255,255,255,0.08)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Rarity stripe at bottom */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px',
        background: config.color,
        boxShadow: `0 0 8px ${config.glowColor}`,
      }} />
      <span style={{ fontSize: '32px', lineHeight: 1 }}>{item.emoji}</span>
      <span style={{
        color: config.color, fontSize: '11px', fontWeight: 'bold',
        fontFamily: 'monospace', textAlign: 'center',
        padding: '0 4px', lineHeight: 1.2,
        maxWidth: '110px', overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{item.name}</span>
      <span style={{
        color: config.color, fontSize: '9px',
        fontFamily: 'monospace', opacity: 0.7,
      }}>{config.label}</span>
    </div>
  );
}

// ─── Result card shown after spin completes ─────────────────────────────────

function ResultCard({ item, onDismiss }: { item: LootItem; onDismiss: () => void }) {
  const config = RARITY_CONFIG[item.rarity];
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const t = setTimeout(() => setScale(1), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      onClick={onDismiss}
      style={{
        background: config.bgGradient,
        border: `2px solid ${config.color}`,
        borderRadius: '16px',
        padding: '24px 36px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: '8px',
        cursor: 'pointer',
        boxShadow: `0 0 40px ${config.glowColor}, inset 0 0 30px ${config.glowColor}`,
        transform: `scale(${scale})`,
        transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      <span style={{ fontSize: '56px', lineHeight: 1 }}>{item.emoji}</span>
      <span style={{
        color: config.color, fontSize: '20px', fontWeight: 'bold',
        fontFamily: 'monospace',
      }}>{item.name}</span>
      <span style={{
        color: config.color, fontSize: '12px', fontFamily: 'monospace',
        textTransform: 'uppercase', letterSpacing: '2px',
      }}>{config.label}</span>
      <span style={{
        color: 'rgba(255,255,255,0.6)', fontSize: '12px',
        fontFamily: 'monospace', textAlign: 'center', maxWidth: '300px',
        fontStyle: 'italic',
      }}>{item.description}</span>
      <span style={{
        color: 'rgba(255,255,255,0.3)', fontSize: '10px',
        fontFamily: 'monospace', marginTop: '4px',
      }}>Click to dismiss</span>
    </div>
  );
}
