# Debug map-switch screenshots

Captured via Playwright + `gl.readPixels` against the actual WebGL
framebuffer. Two frames:

1. `1-default.png` — `default` map loaded. Shows the 25×25 blue
   platform around the player at (12, 2, 12) on an otherwise empty
   sky.
2. `2-long_corridor.png` — switched to `long_corridor`. Shows the
   smaller corridor cube cluster at the new spawn (-7, 2, -1).

History: these were re-captured after the default `<Floor>` (the
hard-coded 27×27 blue platform that Scene used to render
underneath ObjectInstances) was deleted. Earlier screenshots showed
the map content stacked on top of that default Floor — which the
user noticed because there was a stripe of "default" cubes around
the edge of every authored map. With Floor gone, Map Editor maps
are the only visible content.
