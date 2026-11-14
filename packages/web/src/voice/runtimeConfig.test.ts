import { describe, expect, it } from 'vitest';
import { getJaasAppId } from './runtimeConfig';

describe('getJaasAppId', () => {
  it('reads the public app id', () => {
    expect(getJaasAppId({ VITE_JAAS_APP_ID: 'app' })).toBe('app');
  });

  it('is off when the app id is missing or empty', () => {
    expect(getJaasAppId({})).toBeNull();
    expect(getJaasAppId({ VITE_JAAS_APP_ID: '' })).toBeNull();
  });
});
