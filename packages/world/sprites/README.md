# 2D sprites

The 2D view's art, baked from the same KayKit models the 3D view renders, so both views show one
office. `kinds/<kindId>.webp` is a strip of the kind at yaw 0, 90, 180 and 270, rendered through the
2D view's oblique projection (`ELEVATION` in `src/top-down/topDownPainters.ts`): a sprite's
footprint lands exactly on its object's footprint. `characters/<name>.webp` is a sheet per avatar:
rows face down, left, right and up; columns are idle, an 8-frame walk cycle and seated.

`src/top-down/spriteManifest.ts` (generated) lists every sprite with its frame rects and anchors.
Kinds without a sprite (prototype blocks, uploads) keep their procedural painter.

## Regenerating

1. `pnpm asset-packs:install` (the furniture and restaurant packs).
2. `pnpm --filter @officexr/world bake:sprites`
3. Review the images, then commit them with the manifest.

Changing `ELEVATION` means re-baking, or furniture stops lining up with its footprint.
