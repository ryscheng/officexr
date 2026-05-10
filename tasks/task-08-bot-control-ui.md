# Task 08: Add BotControlPanel — bot movement control UI

## Objective
Add a minimal fixed-position overlay panel with three buttons that drive the bot's movement mode.

## Context
- Read `tasks/shared-context.md` before starting.
- `BotDriver` from Task 07 exposes `setMode('idle' | 'walk-to-local' | 'walk-away')`.
- The panel is positioned in the bottom-right corner using `position: fixed` inline styles.
- No CSS files, no styling framework — plain inline styles only.

**Quick Context:**
- Panel component: `packages/debug-app/src/bot/BotControlPanel.tsx`
- Imported and rendered inside `DebugOfficePage` (Task 06).
- `botDriver` may be null during the first render (before `useEffect` runs) — handle with optional chaining or a null check.

## Files to Create
- `packages/debug-app/src/bot/BotControlPanel.tsx`

## Files to Modify
- `packages/debug-app/src/DebugOfficePage.tsx` — replace `() => null` placeholder with real `BotControlPanel` import

## Requirements

### Component signature
```tsx
interface BotControlPanelProps {
  botDriver: BotDriver | null;
}
export function BotControlPanel({ botDriver }: BotControlPanelProps) { ... }
```

### Rendered output
```tsx
<div style={{
  position: 'fixed', bottom: 16, right: 16,
  display: 'flex', flexDirection: 'column', gap: 8,
  background: 'rgba(0,0,0,0.6)', padding: 12, borderRadius: 8,
  color: 'white', fontFamily: 'monospace', fontSize: 13,
}}>
  <div style={{ marginBottom: 4, fontWeight: 'bold' }}>Bot Controls</div>
  <button onClick={() => botDriver?.setMode('idle')}>Stay</button>
  <button onClick={() => botDriver?.setMode('walk-to-local')}>Walk to me</button>
  <button onClick={() => botDriver?.setMode('walk-away')}>Walk away</button>
</div>
```

Buttons should have consistent inline styles: `{ padding: '4px 8px', cursor: 'pointer' }`.

### Active mode indicator (nice-to-have, not required)
If it is straightforward to track which mode is active via React state, highlight the active button with a different background. This is optional — focus on correctness first.

## Acceptance Criteria
- [ ] Panel appears in the bottom-right corner of the browser when the debug app loads.
- [ ] Clicking "Stay" calls `botDriver.setMode('idle')`.
- [ ] Clicking "Walk to me" calls `botDriver.setMode('walk-to-local')`.
- [ ] Clicking "Walk away" calls `botDriver.setMode('walk-away')`.
- [ ] Panel renders without error even when `botDriver` is null (initial render).
- [ ] `pnpm --filter @officexr/debug-app typecheck` passes.

## Dependencies
- Depends on: Task 06 (DebugOfficePage exists), Task 07 (BotDriver type available)
- Blocks: None (final UI polish)
