# Onboarding

Format: rule; **Why**; **Number**; **Here**. Source keys map to `sources.md`.

officexr's first minute: the player lands in an office, may not know anyone is there, and must
learn to move, find a person and talk. Onboarding is not one tutorial; it is every first time
(first move, first person near, first call, first mission, first build).

**O1. Teach by doing, inside play, not with a separate tutorial screen.**
- Why: written tutorials get skipped; players learn by acting. [pvz-tips] [apple-hig-games]
- Number: none.
- Here: no intro slideshow. The first hint is on the joystick zone (touch) or near the avatar
  (desktop: WASD), and goes away when the player moves.

**O2. Get the player to do the action once, with an obvious prompt, at the moment they need it.**
- Why: one guided action beats explanation. [pvz-tips] [android-portrait R11]
- Number: none.
- Here: first time someone is within 8 m: a hint on Wave or Speak ("Say hi"). First mission:
  point at the missions bar once.

**O3. Keep hint text to about eight words.**
- Why: short text gets read. [pvz-tips]
- Number: about 8 words at a time. [pvz-tips]
- Here: "Drag here to walk", "Tap Wave to say hi", "Press B to build".

**O4. One hint at a time; each hint shows at most twice and stops after first use.**
- Why: repeated hints annoy experienced players. [android-portrait R11] [donchitos-hud]
- Number: at most 2 showings. [android-portrait R11]
- Here: store "seen" flags per hint (local storage with a try/catch, like fold prefs).

**O5. Hints do not pause or block play.**
- Why: interrupting play breaks flow; passive hints work. [pvz-tips]
- Number: none.
- Here: hints are toasts or in-world markers, not modals. The only modal allowed at start is a
  permission prompt the browser forces (microphone).

**O6. Show tips only to players who struggle.**
- Why: adaptive tips help the ones who need them and leave the rest alone. [pvz-tips]
- Number: inference: no movement for 10 s after load, or no one approached in 60 s.
- Here: "No one near? Open the map to find people" after the player wanders alone.

**O7. Spread new systems over time; do not show all of them on day one.**
- Why: tutorials spread through the game work better than front-loaded ones. [pvz-tips]
- Number: GoW Ragnarök: 1-2 steps per tutorial is ideal; menu tutorials lose players after
  about 7 steps. [gow-hud]
- Here: move and talk first; missions, emotes, build mode and pings when first relevant.

**O8. Hide a HUD element until its system is unlocked or used.**
- Why: empty slots and unused buttons add noise. [gow-hud] [fold-hide]
- Number: none.
- Here: the ping bell appears after the first ping; build indicator only in build mode.

**O9. Ask for permissions when they are needed, not at load.**
- Why: a request in context is understood and accepted more often. [apple-hig-games]
- Number: none.
- Here: ask for the microphone on the first call or first Speak, not on page load.

**O10. Use familiar conventions.**
- Why: what players know from other games needs no teaching. [pvz-tips]
- Number: none.
- Here: WASD and arrows, Enter to chat, Escape to close, M for map, a joystick bottom-left,
  a red dot badge for unread.

**O11. Let players remind themselves of the controls at any time.**
- Why: GAG basic and intermediate items: reminders of controls, contextual help. [gag]
- Number: none.
- Here: a shortcuts sheet (desktop) in the menu; on touch, a "How to move" entry.

**O12. Teach a new mechanic in four beats: introduce, develop, twist, resolve.**
- Why: Nintendo's level structure (kishotenketsu) introduces one idea safely, then builds on
  it. [gmtk-4step] (seen in summaries; transcript not read)
- Number: none.
- Here: a mission chain: walk to a desk; walk to a person; find a person on the map; join a
  call with two people.

**O13. Test onboarding with new people, and watch, do not tell.**
- Why: designers cannot un-know their game. [prime-teach-observe] [gag]
- Number: inference: 3-5 first-time players per change.
- Here: record where they stall (PostHog replays if available) and fix that spot.
