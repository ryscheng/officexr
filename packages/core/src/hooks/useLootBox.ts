import { useCallback, useRef, useState } from 'react';
import { InventoryItem, LootItem, rollLootItem, generateSpinStrip } from '@/data/lootBoxItems';

const STORAGE_KEY = 'officexr_inventory';
const COOLDOWN_KEY = 'officexr_lootbox_cooldown';
const COOLDOWN_MS = 60_000; // 1 minute

function loadInventory(): InventoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveInventory(items: InventoryItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function loadCooldown(): number {
  try {
    const raw = localStorage.getItem(COOLDOWN_KEY);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function saveCooldown(ts: number) {
  localStorage.setItem(COOLDOWN_KEY, String(ts));
}

export interface LootBoxHandle {
  inventory: InventoryItem[];
  isSpinning: boolean;
  spinStrip: LootItem[] | null;
  wonItem: LootItem | null;
  /** Milliseconds remaining until next box can be opened. 0 = ready. */
  cooldownRemaining: number;
  /** Start opening a box — returns the won item, or null if on cooldown */
  openBox: () => LootItem | null;
  /** Called when the spin animation completes — adds item to inventory */
  finalizeSpin: () => void;
  /** Close the result display and go back to idle */
  dismissResult: () => void;
  /** Remove an item from inventory */
  discardItem: (instanceId: string) => void;
}

export function useLootBox(): LootBoxHandle {
  const [inventory, setInventory] = useState<InventoryItem[]>(loadInventory);
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinStrip, setSpinStrip] = useState<LootItem[] | null>(null);
  const [wonItem, setWonItem] = useState<LootItem | null>(null);
  const wonItemRef = useRef<LootItem | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(() => {
    const elapsed = Date.now() - loadCooldown();
    return elapsed < COOLDOWN_MS ? COOLDOWN_MS - elapsed : 0;
  });
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldownTimer = useCallback((remaining: number) => {
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    setCooldownRemaining(remaining);
    cooldownTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - loadCooldown();
      const left = Math.max(0, COOLDOWN_MS - elapsed);
      setCooldownRemaining(left);
      if (left <= 0 && cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    }, 200);
  }, []);

  // Resume cooldown timer if we loaded with a remaining cooldown
  const hasStartedTimerRef = useRef(false);
  if (!hasStartedTimerRef.current && cooldownRemaining > 0) {
    hasStartedTimerRef.current = true;
    // Start on next tick to avoid setState during render
    setTimeout(() => startCooldownTimer(cooldownRemaining), 0);
  }

  const openBox = useCallback((): LootItem | null => {
    const elapsed = Date.now() - loadCooldown();
    if (elapsed < COOLDOWN_MS) {
      setCooldownRemaining(COOLDOWN_MS - elapsed);
      return null;
    }

    const target = rollLootItem();
    const strip = generateSpinStrip(target);
    wonItemRef.current = target;
    setWonItem(target);
    setSpinStrip(strip);
    setIsSpinning(true);

    // Set cooldown
    const now = Date.now();
    saveCooldown(now);
    startCooldownTimer(COOLDOWN_MS);

    return target;
  }, [startCooldownTimer]);

  const finalizeSpin = useCallback(() => {
    setIsSpinning(false);
    const item = wonItemRef.current;
    if (!item) return;
    const newItem: InventoryItem = {
      ...item,
      instanceId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      obtainedAt: Date.now(),
    };
    setInventory(prev => {
      const updated = [newItem, ...prev];
      saveInventory(updated);
      return updated;
    });
  }, []);

  const dismissResult = useCallback(() => {
    wonItemRef.current = null;
    setWonItem(null);
    setSpinStrip(null);
  }, []);

  const discardItem = useCallback((instanceId: string) => {
    setInventory(prev => {
      const updated = prev.filter(i => i.instanceId !== instanceId);
      saveInventory(updated);
      return updated;
    });
  }, []);

  return {
    inventory,
    isSpinning,
    spinStrip,
    wonItem,
    cooldownRemaining,
    openBox,
    finalizeSpin,
    dismissResult,
    discardItem,
  };
}
