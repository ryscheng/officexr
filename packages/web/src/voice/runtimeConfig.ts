import type { RUNTIME_CONFIG_KEYS } from '../../server/runtimeConfig';

type RuntimeConfig = Partial<Record<(typeof RUNTIME_CONFIG_KEYS)[number], string>>;

declare global {
  interface Window {
    __OFFICEXR_CONFIG__?: RuntimeConfig;
  }
}

export interface JaasConfig {
  appId: string;
  apiKeyId: string;
  privateKeyPem: string;
}

/** The JaaS keys `/config.js` set, or null when this deployment has no voice. */
export function getJaasConfig(): JaasConfig | null {
  const {
    VITE_JAAS_APP_ID: appId,
    VITE_JAAS_API_KEY_ID: apiKeyId,
    VITE_JAAS_PRIVATE_KEY: privateKeyB64,
  } = window.__OFFICEXR_CONFIG__ ?? {};
  if (!appId || !apiKeyId || !privateKeyB64) {
    return null;
  }
  return { appId, apiKeyId, privateKeyPem: atob(privateKeyB64) };
}
