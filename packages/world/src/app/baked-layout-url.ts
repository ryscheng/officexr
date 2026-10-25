/** Server path that serves (GET/HEAD) and stores (PUT) a layout's baked GLB. */
export function bakedLayoutUrl(layoutName: string, basePath = '/api/baked-layouts'): string {
  return `${basePath.replace(/\/$/, '')}/${encodeURIComponent(layoutName)}`;
}
