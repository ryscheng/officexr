# Office motions: swim, rides, poke

Frames from the studio Debug mode on the `pool_party` sample map (same `Scene` the office uses), captured with
Chromium and software GL. Strips: `strip-swim.png`, `strip-scooter.png`, `strip-tricycle.png`, `strip-poke.png`.

- Swim: the first frame is the local player floating on its back (arms spread, slow bob and sway). The other two
  are a peer whose `pose: 'swim'` and broadcast velocity turn it face down into a crawl (paddle, then stroke).
- Scooter and tricycle: the vehicle is drawn under the rider, local and peers, and the rack is empty while it is
  ridden. Mounted and riding frames are the local player (F next to the rack); the `peer` frames are a remote
  rider, and the scooter leans into a turn from the peer's yaw rate. Dismounting returns the vehicle to its rack.
- Poke: the arm clip and the spark are held for the capture so a slow software renderer can catch them; in the game
  the poke lasts 0.9 s and the spark 0.65 s. The poked player turns toward the poker and flinches.
