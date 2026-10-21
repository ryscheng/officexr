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

/** The JaaS keys `/config.js` set, or null when this deployment has no (usable) voice config. */
export function getJaasConfig(config: RuntimeConfig = window.__OFFICEXR_CONFIG__ ?? {}): JaasConfig | null {
  const { VITE_JAAS_APP_ID: appId, VITE_JAAS_API_KEY_ID: apiKeyId, VITE_JAAS_PRIVATE_KEY: privateKeyB64 } = config;
  if (!appId || !apiKeyId || !privateKeyB64) {
    return null;
  }
  try {
    return { appId, apiKeyId, privateKeyPem: atob(privateKeyB64) };
  } catch (err) {
    console.error('VITE_JAAS_PRIVATE_KEY is not valid base64; voice is off:', err);
    return null;
  }
}
