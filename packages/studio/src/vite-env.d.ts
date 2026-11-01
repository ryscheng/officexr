/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin that serves the studio's `models/**` and baked layouts, when it isn't the page's own origin. */
  readonly VITE_ASSET_BASE_URL?: string;
}
