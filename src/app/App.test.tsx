// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../tests/fixtures/catalog/catalog.json';
import { App } from './App';

describe('app Pages asset paths', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('loads the catalog below the configured Vite base path', async () => {
    vi.stubEnv('BASE_URL', '/macau-bus-pwa/');
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetcher);

    render(<App />);

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/macau-bus-pwa/data/catalog.json'));
  });
});
