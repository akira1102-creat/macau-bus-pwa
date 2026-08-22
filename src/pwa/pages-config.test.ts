import { afterEach, describe, expect, it, vi } from 'vitest';

describe('GitHub Pages Vite configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the repository name as the project Pages base path in Actions', async () => {
    vi.resetModules();
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_REPOSITORY', 'example-owner/macau-bus-pwa');

    const imported = await import('../../vite.config');
    const config = typeof imported.default === 'function'
      ? imported.default({ command: 'build', mode: 'production' } as never)
      : imported.default;

    expect(config.base).toBe('/macau-bus-pwa/');
  });

  it('keeps the root base path for local development', async () => {
    vi.resetModules();
    vi.stubEnv('GITHUB_ACTIONS', '');
    vi.stubEnv('GITHUB_REPOSITORY', 'example-owner/macau-bus-pwa');

    const imported = await import('../../vite.config');
    const config = typeof imported.default === 'function'
      ? imported.default({ command: 'serve', mode: 'development' } as never)
      : imported.default;

    expect(config.base).toBe('/');
  });
});
