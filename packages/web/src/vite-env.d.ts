/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the OfficeXR backend when it isn't served from the SPA's own origin. */
  readonly VITE_API_ORIGIN?: string;
}
