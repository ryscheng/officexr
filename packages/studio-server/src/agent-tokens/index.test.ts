import { describe, expect, it } from 'vitest';
import type { OAuthEnv } from '../oauth/index.ts';
import { parseAgentTokenEnv } from './index.ts';

const oauth: OAuthEnv = { type: 'enabled', issuerUrl: 'https://studio.example', webPublicUrl: 'https://web.example' };
const secret = 's'.repeat(32);

describe('parseAgentTokenEnv', () => {
  it('is disabled when neither var is set', () => {
    expect(parseAgentTokenEnv({}, oauth)).toEqual({ type: 'disabled' });
  });

  it('trims the inputs and strips a trailing slash', () => {
    expect(parseAgentTokenEnv({ OFFICEXR_STUDIO_API_JWT_SECRET: ` ${secret} `, STUDIO_APP_URL: ' https://app.example/ ' }, oauth)).toEqual({
      type: 'enabled',
      secret,
      studioAppUrl: 'https://app.example',
      issuerUrl: 'https://studio.example',
    });
  });

  it('rejects a short secret', () => {
    expect(parseAgentTokenEnv({ OFFICEXR_STUDIO_API_JWT_SECRET: 'short', STUDIO_APP_URL: 'https://app.example' }, oauth).type).toBe('invalid');
  });

  it('rejects only one var set', () => {
    expect(parseAgentTokenEnv({ OFFICEXR_STUDIO_API_JWT_SECRET: secret }, oauth).type).toBe('invalid');
    expect(parseAgentTokenEnv({ STUDIO_APP_URL: 'https://app.example' }, oauth).type).toBe('invalid');
  });

  it('rejects a non-http app url', () => {
    expect(parseAgentTokenEnv({ OFFICEXR_STUDIO_API_JWT_SECRET: secret, STUDIO_APP_URL: 'ftp://x' }, oauth).type).toBe('invalid');
  });

  it('rejects both vars when MCP OAuth is disabled', () => {
    const result = parseAgentTokenEnv({ OFFICEXR_STUDIO_API_JWT_SECRET: secret, STUDIO_APP_URL: 'https://app.example' }, { type: 'disabled' });
    expect(result).toMatchObject({ type: 'invalid', problem: expect.stringContaining('STUDIO_PUBLIC_URL') });
  });
});
