import type { RuntimeConfig } from './runtime-config';

declare global {
  interface Window {
    __OFFICEXR_CONFIG__?: RuntimeConfig;
  }
}
