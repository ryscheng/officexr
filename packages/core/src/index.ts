// Barrel for platform-agnostic exports consumed by packages/mobile and other
// non-web packages. Only types and pure data are exported here; the web
// Supabase client (import.meta.env) lives in lib/supabase.ts and must be
// imported directly rather than through this barrel.
export type { Database } from './lib/supabase.js';
export * from './types/avatar.js';
