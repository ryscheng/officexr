# Social spaces

Format: rule; **Why**; **Number**; **Here**. Source keys map to `sources.md`.

officexr is a place to meet. The social layer (who is here, who can hear me, how to start and
leave a conversation) matters more than any single feature.

## Presence

**S1. Show who is here, who is near, and who can hear you, at a glance.**
- Why: awareness of others is the reason for a shared space. [gather-spatial] [gag]
- Number: none.
- Here: avatars and name tags (in world), near-you card (within 8 m), people list on demand,
  call pill while in a call. A player must always be able to answer "can anyone hear me now?".

**S2. Status is a short line plus a state, visible in the world and in the list.**
- Why: status lets people decide whether to approach. [fold-hide] [office-status]
- Number: keep a status line short enough for one line on a phone (inference: about 30
  characters before truncation).
- Here: status emoji and text, focus mode (purple tag, bell off), away, raised hand.

**S3. Announce arrivals and departures lightly.**
- Why: a quiet signal keeps awareness without noise. [fold-hide]
- Number: arrival bubble 4 s.
- Here: no sound for every join in a busy office; batch "3 people joined".

## Proximity voice

**S4. Voice fades in with distance, with a clear "can hear" edge.**
- Why: natural, low-effort conversation start; fading avoids sudden cuts. [gather-spatial]
- Number: Gather: starts connecting at 5 tiles, full within 2 tiles; quiet mode 1 tile.
- Here: officexr uses an 8 m near range for the near-you card. Show the hearing range (a ring
  on the floor or a "can hear you" list) so players are not surprised.

**S5. Give private areas: everyone inside hears each other regardless of distance; outsiders do not.**
- Why: rooms and meeting spots make conversation safe and predictable. [gather-spatial]
  [workadventure]
- Number: none.
- Here: meeting rooms and desks; show a clear edge and a "private" marker on entry.

**S6. Give a "do not disturb" that blocks voice entirely, and a quiet mode that shrinks range.**
- Why: focus time is a core office need. [gather-spatial]
- Number: Gather quiet mode = 1 tile.
- Here: focus mode exists (Alt+N); make sure it also stops proximity audio, and show it on the tag.

**S7. Leaving is as easy as joining.**
- Why: no one should feel trapped in a call. Inference from [gather-spatial] (walk away to leave).
- Number: leave and mute always visible while in a call.
- Here: call pill keeps title, mute and leave even folded.

**S8. Broadcast (speak to all) is a separate, visible, limited tool.**
- Why: Gather limits spotlight to rooms under 100-150 people. [gather-spotlight]
- Number: Gather: about 100-150 people per spotlight.
- Here: if added, show a clear "you are broadcasting" banner.

## Chat

**S9. Chat: an entry with an unread badge, a short peek on new messages, a full sheet for typing.**
- Why: chat should be present without covering the world; keyboards cover half a phone. [android-portrait R14]
- Number: peek 4-6 s (officexr: 10 s); send button 48 px.
- Here: ChatPanel peeks on a new message and stays while typing.

**S10. Scope chat clearly: nearby, room, or direct.**
- Why: players must know who reads a message. [gather-chat]
- Number: none.
- Here: label the scope in the input placeholder; meeting chat can end with the meeting.

**S11. Quick phrases and emotes for players who cannot or will not type or speak.**
- Why: symbol chat and chat wheels are accessible and cross language barriers. [gag] [xag-119]
  [emote-chapter]
- Number: none.
- Here: a row of emotes and quick replies in the chat sheet.

## Emotes and gestures

**S12. A small set of clear emotes; people copy each other, so group emotes should look good together.**
- Why: emotes are a shared, limited vocabulary; players join in each other's emotes and use
  them to show presence while waiting. [emote-chapter]
- Number: inference: 6-8 emotes in the quick set.
- Here: wave, clap, party, thumbs up, heart, laugh; bubble above the avatar for 2-3 s.

**S13. Wave is the "hello" verb: one tap, near someone, and the target sees who waved.**
- Why: a low-cost social opener. Inference from [emote-chapter] and the existing Wave button.
- Number: none.
- Here: Wave appears when someone is near; the receiver gets a small toast with the name.

## Privacy and safety

**S14. Personal space: on by default for people you do not know, adjustable.**
- Why: Meta added a personal boundary to stop harassment; default on sets norms; avatars can
  still pass so no one gets trapped. [meta-boundary-press]
- Number: Meta: about 2 ft radius per avatar, about 4 ft between avatars.
- Here: if officexr adds collision between avatars, never let it block a door or desk.

**S15. Mute, block and report one tap away from any person.**
- Why: safety tools must be faster than the problem. [xag-119] [vr-safety-paper]
- Number: none.
- Here: person card actions: mute for me, block, report. Blocked people do not hear or see you.

**S16. Never broadcast a player's audio or location without a visible sign.**
- Why: privacy; players must know when they are heard or seen. Inference from [gather-spatial].
- Number: none.
- Here: mic state on own tag; "you are in a call" pill; a "who can see me" note in the people
  list for private offices.

**S17. Some players do not want to share their voice: offer a text-only preference.**
- Why: XAG 119 lists privacy and no microphone as reasons. [xag-119] [gag]
- Number: none.
- Here: "text only" state shown on the tag.
