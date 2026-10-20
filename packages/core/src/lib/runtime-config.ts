import type { RUNTIME_CONFIG_KEYS } from './runtime-config-keys';

export type RuntimeConfig = Partial<Record<(typeof RUNTIME_CONFIG_KEYS)[number], string>>;

/** Reads `/config.js` values (set at container start) over the build-time `import.meta.env` fallback. */
export function getRuntimeConfig(): RuntimeConfig {
  const buildTime: RuntimeConfig = {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_JAAS_APP_ID: import.meta.env.VITE_JAAS_APP_ID,
    VITE_JAAS_API_KEY_ID: import.meta.env.VITE_JAAS_API_KEY_ID,
    VITE_JAAS_PRIVATE_KEY: import.meta.env.VITE_JAAS_PRIVATE_KEY,
  };
  return { ...buildTime, ...window.__OFFICEXR_CONFIG__ };
}
