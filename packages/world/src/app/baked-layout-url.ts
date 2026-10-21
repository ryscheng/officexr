/** Server path that serves (GET/HEAD) and stores (PUT) a layout's baked GLB. */
export function bakedLayoutUrl(layoutName: string): string {
  return `/api/baked-layouts/${encodeURIComponent(layoutName)}`;
}
