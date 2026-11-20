---
name: game-designer
description: Game-design and HUD rules for officexr. Use when you design or change any player-facing feature - HUD or panel, control, touch layout, onboarding hint, feedback or effect, social feature (proximity, chat, emotes), or a mode such as build mode - on desktop, phone landscape or phone portrait.
---

# Game designer (officexr)

officexr is a social 3D office, not a combat game. People come to find each other, talk and
work. The world is the main screen; the HUD is a thin frame around it. Every feature should
make it easier to see who is here, reach them and do the task, without covering the world.

The rules below are short. Each reference file gives the rule, why, a number where a source
has one, and what it means here. Sources and licenses are in `references/sources.md`.

## 1. Decide before you code

Answer these five in the PR description or task note. If you cannot, the design is not ready.

1. **Who is the player and where are they?** A colleague on a laptop with a keyboard, or on a
   phone in one hand (portrait) or two thumbs (landscape)? First visit or daily use? Pick the
   hardest case you must support and design for it first: usually phone portrait.
2. **What is the core loop this feature serves?** officexr's loop: arrive, see who is near,
   move to them, talk (voice or chat) or act (emote, wave, mission, build), leave. Say which
   step the feature makes faster or clearer. If it serves none, question it.
3. **What is the moment-to-moment feel?** What does the player press, what answers within
   100 ms, what confirms the result? (`references/game-feel.md`)
4. **What must the HUD show now, and what on demand?** Sort every piece of information into
   always, contextual (appears when relevant, leaves when not), on demand (behind a button) or
   in the world (name tags, bubbles, props). Default is contextual. A permanent control for a
   rare event is a fault. (`references/hud-and-ui.md`)
5. **What are the controls on each device?**
   - Desktop: keyboard and mouse; a key for each frequent action; key hints only here.
   - Phone landscape: two thumbs; joystick bottom-left, context actions bottom-right; side
     safe areas are large (notch).
   - Phone portrait: one thumb; primary actions in the bottom 40%; low-frequency items top;
     one panel open at a time. (`references/mobile-controls.md`)
   A feature that only works with a key (build mode today) is not done on touch. Say so.

## 2. Rules that apply to every feature

- At most 5-6 controls visible at rest on a phone. Count them.
- Touch targets at least 44 px (repo test), 48 px preferred, 8 px apart.
- Nothing inside the safe area insets; use the `--hud-inset-*` tokens, never a fixed px edge.
- One panel open at a time on phone portrait. Opening one folds or closes the others.
- Every action answers: visible state change within 100 ms, plus a confirm (toast, bubble,
  sound) when the result is not visible on screen.
- Transient messages: one at a time, top centre, short, queued; never over the bottom controls.
- No information by colour alone; text contrast 4.5:1; body text 16 px or more on phones,
  never under 12 px for any label a player must read.
- Key hints (keycaps) only when a keyboard is the input; hide them on touch.
- Settings the user chose (fold state, toggles) persist, and still work when storage throws.
- Voice is never required: every voice path has a text or emote path.

## 3. Checklist before a PR

- [ ] Rendered and looked at on desktop 1440x900, phone landscape (iPhone 13) and phone
      portrait (iPhone 13 and iPhone SE), light and dark, from `/hud-preview`:
      `pnpm --filter @officexr/web dev:hud-preview`, then `/hud-preview?scenario=<name>`.
      Scenarios: `crowd`, `alone`, `missions`, `new-mission`, `frozen`, `wand`, `build`,
      `focus`, `full`. Batch capture with
      `HUD_CAPTURE_DIR=docs/hud-review/<topic> HUD_CAPTURE_DEVICES=desktop,iphone13-landscape,iphone13-portrait,iphone-se-portrait HUD_CAPTURE_SCENARIOS=crowd,build pnpm exec playwright test tests/playwright/hud-capture.spec.ts`.
      Each `.png` has a `.json` box dump: read its overlaps, outside-safe-area and small-target lists.
- [ ] `pnpm exec playwright test tests/playwright/hud-layout.spec.ts` passes: no overlapping HUD
      boxes, nothing outside the safe area, 44 px targets, no horizontal scroll, canvas fills
      the viewport.
- [ ] Count visible controls at rest on each phone layout (target 5-6 or fewer).
- [ ] Open each new panel on portrait: it closes the others and does not cover the joystick.
- [ ] Every new action has feedback (press state, result, and a confirm when off screen).
- [ ] Keyboard path works (Tab, Enter, Escape closes the top layer); `aria-expanded` and labels
      on toggles; no colour-only state; text sizes and contrast checked.
- [ ] Reduced motion respected for new animation; no flashing above 3 per second.
- [ ] Renderer change? Run the mugshot specs too (repo `CLAUDE.md`).
- [ ] Captures for the review saved under `docs/hud-review/<topic>/`, with a short README of
      what changed and why.

## 4. Known traps in this repo

Read `docs/hud-review/README.md` and `docs/hud-review/fold-hide.md` on main before HUD work.
What went wrong before:

- **Too many touch buttons.** A touch action pad (Jump, Sprint, Poke, Emote, Hand, Build in
  rings), a six-wide top row, a 448 px build panel and a spell bar were added, then reverted:
  they overlapped each other, the minimap and toasts on an 844 px wide phone. Add controls in
  context, not as a permanent ring.
- **Fixed 12 px edge inset.** It ignored the notch; eight controls sat under it in iPhone
  landscape (47 px side insets). Use `--hud-inset-*` (12 px or the safe area, whichever is
  larger) and `viewport-fit=cover`.
- **Keycap hints on touch** (Enter, R, Tab, 1-4) mean nothing there. Hide them on touch.
- **Small text and targets.** 10-11 px text, 7-8 px minimap labels, 27 px spell slots, a 16 px
  "(you)" button; long names cut with no way to read them in full.
- **No rule for panel widths** (224-448 px). Pick from a small set.
- **One icon, two meanings** (speech bubble for status and for chat) and icon-only rows. Give
  each meaning its own icon, and a label or tooltip.
- **Permanent controls for rare events** (the ping bell). Show them only once relevant.
- **Desktop-only prompts on touch.** The click-to-play prompt covered the middle of the portrait
  view; a touch screen has no keyboard focus to lose.
- **Portrait was blocked** by a "Turn your phone" prompt. Portrait is now a first-class layout;
  never reintroduce a rotate gate.
- **Build mode has no touch path** (needs B). Any build-mode change must say what touch users get.
- **Scope.** The owner asked once for only the safe-area fix and "the rest left for the design".
  Do not redesign the layout beyond the ask; record other faults in `docs/hud-review/`.
- **Capture limits.** Captures run at 1x with software WebGL; `full` on desktop can time out.
  Capture fewer scenarios per run with `HUD_CAPTURE_SCENARIOS`.

## 5. Reference files

| File | Read when |
|---|---|
| `references/hud-and-ui.md` | Any HUD element, panel, toast, map, text, layout zone |
| `references/mobile-controls.md` | Joystick, touch buttons, thumb zones, portrait vs landscape |
| `references/game-feel.md` | Feedback, animation timing, sound, haptics, "it feels dead" |
| `references/onboarding.md` | First-run hints, tutorials, teaching a new control or mode |
| `references/accessibility.md` | Text, contrast, colour, motion, input alternatives, voice/text |
| `references/social-spaces.md` | Proximity voice, presence, chat, emotes, privacy, safety |
| `references/templates-and-kits.md` | Looking for a known pattern in an open-source kit |
| `references/sources.md` | Every source read, its type and license, what we took |

Owner rule for this skill: we keep ideas and rules only, in our own words. Do not install
third-party skill packs, plugins or binaries, and do not copy their code or art.
