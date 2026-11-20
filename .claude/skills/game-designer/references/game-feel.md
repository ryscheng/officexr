# Game feel

Format: rule; **Why**; **Number**; **Here**. Source keys map to `sources.md`.

Game feel = how an action feels in the hand: response time, motion, sound and the small
reactions around it. "Juice" = extra feedback on top of a working action. officexr is calm and
social, so feedback must be clear and quick, but small. Big shake and flashes belong to action
games, not an office.

## A. Response

**F1. Answer every input within 100 ms with a visible change.**
- Why: under about 0.1 s the user feels direct control; up to 1 s flow is kept; over 1 s show
  progress. [nng-response] [swink]
- Number: 0.1 s / 1 s / 10 s limits [nng-response]. Fast games measured at 50-67 ms (3-4 frames
  at 60 fps) feel tight; 167 ms or more feels sluggish. [west-latency]
- Here: movement starts on the next frame; a button shows its press state at once; network
  actions (send chat, place prop, start call) show an optimistic or pending state at once, and
  a spinner only after 1 s.

**F2. Keep response time steady.**
- Why: a wide spread (7-18 frames in one game) reads as a bug and feels worse than steady
  delay. [west-latency]
- Number: none.
- Here: avoid input handlers that sometimes wait on network or storage.

**F3. Be forgiving: widen timing and position windows in the player's favour.**
- Why: generous windows make hard input feel fair; the player never sees the help.
  [celeste-forgiveness]
- Number: Celeste examples: jump allowed a short time after leaving a ledge (coyote time),
  jumps pressed just before landing still fire (buffer), wall jump from 2 px away.
- Here: a buffered jump on landing; a tap on an avatar that hits near the avatar still selects
  it; interaction range a little larger than it looks; snap the joystick direction near the
  axes.

## B. Feedback bundles

**F4. Give each event a tier and fire that tier's bundle from one place.**
- Why: keeps feedback proportional across the game; routine actions do not drown big ones.
  [gamedev-feel]
- Number: small = tick sound or slight scale, no shake; medium = sound + short animation +
  particles; large = more of all. Start with 2-3 channels per event.
- Here: small: button press, footstep, chat sent. Medium: someone joins near you, a wave
  received, mission step done, prop placed. Large: mission complete, entering a call. Nothing in
  officexr needs screen shake by default.

**F5. Everything that moves eases; nothing pops in or out.**
- Why: easing reads as weight; linear tweens read as mechanical. [juice-talk] [gamedev-feel]
- Number: ease-out to settle, a slight overshoot for a pop; UI transitions about 150-300 ms
  (300 ms HUD fade [donchitos-hud]; 200 ms context button in [android-portrait R17]).
- Here: panels slide and fade about 200 ms; bubbles scale in with slight overshoot; toasts fade.

**F6. The world reacts to the player.**
- Why: reactions make a space feel alive (a core point of "Juice it or lose it"). [juice-talk]
- Number: none.
- Here: avatars turn their heads toward someone who waves; doors or props react on approach;
  name tags brighten when someone speaks.

**F7. Effects return exactly to rest and never block input.**
- Why: drift and long freezes stop reading as feedback and feel like lag. [gamedev-feel]
- Number: any freeze under about 0.15 s; buffer input through it.
- Here: every scale or colour tween ends on its rest value; kill the old tween on retrigger.

**F8. Juice is visual only; it never changes the simulation.**
- Why: shaking a body breaks collision; shake the camera or a visual pivot. [gamedev-feel]
- Number: none.
- Here: animation offsets on the render side only; physics and network state stay clean
  (repo rule: renderer in `@officexr/world`, logic headless).

**F9. Sound carries half the feel; give each frequent action a short, distinct sound, with a mute.**
- Why: sound confirms without the eyes; a bass thump sells weight. [juice-talk]
- Number: UI sounds under about 200 ms (inference); never the only signal (accessibility).
- Here: join, leave, ping, wave and mission-done sounds; separate volume from voice chat.

**F10. Do not over-juice routine actions.**
- Why: too much motion causes nausea and hides the events that matter. [gamedev-feel]
  [juice-critique]
- Number: footsteps and button presses get the small tier or nothing.
- Here: an office is used for hours; keep idle animation and particles low.

## C. Motion safety

**F11. Respect reduced motion and never flash more than 3 times per second.**
- Why: vestibular and photosensitive players. [gamedev-feel] [gag]
- Number: WCAG 2.3.1: at most 3 flashes per second.
- Here: under `prefers-reduced-motion`, replace slides and bounces with fades, stop camera bob,
  and keep camera moves short.

**F12. Camera moves are slow and smooth, and the player can turn them down.**
- Why: a camera that moves on its own causes motion sickness; mismatch between stick and camera
  movement is listed by GAG. [gag]
- Number: none.
- Here: camera follow with damping; no automatic swings; field of view setting if FOV changes.

## D. How to tune

**F13. Add one effect at a time and play it.**
- Why: talks on juice build feel up by layering small changes, each judged in play. [juice-talk]
  [screenshake-talk]
- Number: Nijman's talk added about 30 small tweaks to one plain shooter.
- Here: change one thing, capture in `/hud-preview` or the studio Debug view, compare before
  and after.
