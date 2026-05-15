# Debug map-switch screenshots

Captured via Playwright + `gl.readPixels` against the actual WebGL
framebuffer in `tests/playwright/debug-mode.spec.ts` (the "Map switch
in Debug actually changes the rendered world" test). Two frames:

1. `1-default.png` — `default` map loaded. Shows the 25×25 blue
   platform around the player at (12, 2, 12).
2. `2-long_corridor.png` — switched to `long_corridor`. Shows the
   smaller corridor cube cluster at the new spawn (-7, 2, -1).

These were captured after the `ObjectInstances` mount fix — Scene
wasn't actually rendering the per-map cubes at all before, which is
why earlier screenshots only showed the player teleporting against
an unchanged backdrop.
