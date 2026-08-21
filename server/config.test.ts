import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveServerConfig } from './config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('server environment configuration', () => {
  it('recognizes only an explicit development NODE_ENV as development', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(resolveServerConfig().environment).toBe('development');
  });

  it.each(['production', 'staging', 'preview', 'development-preview', 'typo'])('fails closed for NODE_ENV=%s', (value) => {
    vi.stubEnv('NODE_ENV', value);

    expect(resolveServerConfig().environment).not.toBe('development');
  });

  it('fails closed when NODE_ENV is unset', () => {
    vi.unstubAllEnvs();
    delete process.env.NODE_ENV;

    expect(resolveServerConfig().environment).not.toBe('development');
  });
});
