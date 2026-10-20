import type { Connect } from 'vite';

export const RUNTIME_CONFIG_KEYS = [
  'VITE_JAAS_APP_ID',
  'VITE_JAAS_API_KEY_ID',
  'VITE_JAAS_PRIVATE_KEY',
] as const;

/** Serves `/config.js` from env at request time so one build can be configured per deployment. */
export function configJsMiddleware(extraEnv: Record<string, string> = {}): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.url?.split('?')[0] !== '/config.js') {
      return next();
    }
    const env = { ...extraEnv, ...process.env };
    const config = Object.fromEntries(
      RUNTIME_CONFIG_KEYS.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]),
    );
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-store');
    res.end(`window.__OFFICEXR_CONFIG__ = ${JSON.stringify(config)};`);
  };
}
