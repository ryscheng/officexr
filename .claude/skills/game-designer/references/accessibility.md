# Accessibility

Format: rule; **Why**; **Number**; **Here**. Source keys map to `sources.md`. Main sources: Game
Accessibility Guidelines (GAG) [gag] and Xbox Accessibility Guidelines (XAG) [xag-101] [xag-102]
[xag-107] [xag-119]. GAG levels: basic, intermediate, advanced.

## Vision

**A1. Text contrast at least 4.5:1; large text and key visuals 3:1; high-contrast mode 7:1.**
- Why: low vision, glare, small screens. [xag-102]
- Number: 4.5:1 standard, 3:1 large or inactive, 7:1 in a high-contrast mode. Over a busy 3D
  background, measure against the lightest or darkest area behind the text.
- Here: glass panels over a bright office can fail. Add a backing or raise panel opacity;
  check light and dark themes.

**A2. Never use colour alone.**
- Why: colour-blind players. [gag basic] [xag-102]
- Number: none.
- Here: presence (active, away, focus) needs an icon or text as well as a colour; mission
  state needs a check mark, not only green.

**A3. Text size: readable by default and scalable.**
- Why: XAG 101. [xag-101]
- Number: PC 18 px at 1080p; scale to 200% without loss; line length up to 80 characters;
  line spacing 1.5; letter spacing 0.12x and word spacing 0.16x the font size.
- Here: phone body text 16 px or more; no label under 12 px; respect browser zoom.

**A4. In-world text gets an outline or a backing plate.**
- Why: in-world text sits on any colour. [xag-101] [xag-102]
- Number: none.
- Here: name tags and bubbles.

**A5. Screen-reader and keyboard: every HUD control is a real button with a name.**
- Why: GAG "screen reader support" and "UI reachable with the same input as gameplay". [gag]
- Number: none.
- Here: `aria-expanded` on fold toggles (already in `FoldablePanel`), `aria-label` on icon
  buttons, Escape closes the top layer, focus returns to the opener.

## Hearing and speech

**A6. Voice is never required: text chat and emotes cover every voice path.**
- Why: GAG "support text chat as well as voice"; XAG 119: voice and text are not substitutes
  for each other; let players choose. [gag] [xag-119]
- Number: none.
- Here: a player without a microphone can chat, emote and wave, and others can see that they
  are text-only.

**A7. Show who is speaking.**
- Why: GAG intermediate. [gag]
- Number: none.
- Here: speaking ring on the avatar and on the call list row.

**A8. Plan speech-to-text and text-to-speech for chat.**
- Why: XAG 119 (d/Deaf and non-verbal players). [xag-119]
- Number: none.
- Here: future work; read incoming chat and emotes via a live region; emoji announced by name.

**A9. No information by sound alone.**
- Why: GAG basic. [gag]
- Number: none.
- Here: join and ping sounds also show a toast or badge.

## Motor

**A10. Large, well-spaced touch targets; stationary targets for anything that needs accuracy.**
- Why: GAG basic and intermediate. [gag] [xag-107]
- Number: 44 px minimum (repo test), 48 px preferred, 8 px gap.
- Here: see `mobile-controls.md` M10-M11.

**A11. No button mashing, no required long holds, no required drag paths.**
- Why: GAG intermediate; XAG 107 alternatives to path gestures. [gag] [xag-107]
- Number: none.
- Here: tap-to-move as an alternative to the joystick; toggles instead of holds.

**A12. Support more than one input; allow remapping on desktop.**
- Why: GAG basic and intermediate. [gag]
- Number: none.
- Here: keyboard, mouse and touch all reach every feature; a gamepad is a future option.

## Cognitive and motion

**A13. Simple clear language; contextual help; reminders of controls.** [gag]
- Here: plain button labels ("Leave call", not an icon alone).

**A14. Avoid sudden unexpected movement; offer reduced motion.** [gag advanced] [gamedev-feel]
- Number: at most 3 flashes per second (WCAG 2.3.1).
- Here: honour `prefers-reduced-motion`.

**A15. Settings are saved and remembered.** [gag basic]
- Here: fold state, mute, volume, hint "seen" flags; tolerate storage failure.

**A16. Play in both portrait and landscape.** [gag advanced]
- Here: done; do not add a rotate gate.

**A17. Ask players with disabilities for feedback and include them in tests.** [gag]
