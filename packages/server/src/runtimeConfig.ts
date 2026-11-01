import type { NextHandleFunction } from 'connect';
import { RUNTIME_CONFIG_KEYS } from './shared';

/** Serves `/config.js` from env at request time so one build can be configured per deployment. */
export function configJsMiddleware(extraEnv: Record<string, string> = {}): NextHandleFunction {
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
