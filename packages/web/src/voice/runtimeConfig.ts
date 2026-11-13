import type { RUNTIME_CONFIG_KEYS } from '@officexr/server/shared';

type RuntimeConfig = Partial<Record<(typeof RUNTIME_CONFIG_KEYS)[number], string>>;

declare global {
  interface Window {
    __OFFICEXR_CONFIG__?: RuntimeConfig;
  }
}

/**
 * The JaaS app id `/config.js` set, or null when this deployment has no voice. The app id is public; tokens are
 * minted by the server (`fetchJaasToken`), which holds the private key.
 */
export function getJaasAppId(config: RuntimeConfig = window.__OFFICEXR_CONFIG__ ?? {}): string | null {
  return config.VITE_JAAS_APP_ID || null;
}
