import { describe, expect, it, vi } from 'vitest';
import { getJaasConfig } from './runtimeConfig';

const keys = { VITE_JAAS_APP_ID: 'app', VITE_JAAS_API_KEY_ID: 'kid' };

describe('getJaasConfig', () => {
  it('decodes the base64 private key', () => {
    expect(getJaasConfig({ ...keys, VITE_JAAS_PRIVATE_KEY: btoa('PEM') })).toEqual({
      appId: 'app',
      apiKeyId: 'kid',
      privateKeyPem: 'PEM',
    });
  });

  it('turns voice off instead of throwing on a malformed key', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getJaasConfig({ ...keys, VITE_JAAS_PRIVATE_KEY: 'not base64!' })).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('is off when a key is missing', () => {
    expect(getJaasConfig(keys)).toBeNull();
  });
});
