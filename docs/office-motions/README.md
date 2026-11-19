# Office motions: swim, rides, poke

Frames from the studio Debug mode on the `pool_party` sample map (same `Scene` the office uses), captured with
Chromium and software GL. Strips: `strip-swim.png`, `strip-scooter.png`, `strip-tricycle.png`, `strip-poke.png`.

- Swim: the first frame is the local player treading water; the other two are a peer whose `pose: 'swim'` and
  broadcast velocity make it paddle and stroke, so they also show the synced path.
- Scooter and tricycle: mounted and riding frames are the local player (F next to the rack); the `peer` frames are a
  remote rider. The scooter leans into a turn from the peer's yaw rate.
- Poke: the arm clip is held at full reach for the capture so a slow software renderer can catch it; in the game it
  plays for 0.6 s. The poked player turns toward the poker and flinches.
