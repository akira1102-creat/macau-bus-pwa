import { describe, expect, it } from 'vitest';

import { resolveLocalCommand } from './dev-runtime';

describe('cross-platform development process launcher', () => {
  it('runs local Vite and tsx entrypoints through the Node executable', () => {
    const vite = resolveLocalCommand('vite', {
      cwd: 'D:/workspace/macau-bus-pwa',
      nodeExecutable: 'node.exe',
    });
    const tsx = resolveLocalCommand('tsx', {
      cwd: 'D:/workspace/macau-bus-pwa',
      nodeExecutable: 'node.exe',
    });

    expect(vite.executable).toBe('node.exe');
    expect(vite.args[0]?.replaceAll('\\', '/')).toContain('node_modules/vite/bin/vite.js');
    expect(tsx.executable).toBe('node.exe');
    expect(tsx.args[0]?.replaceAll('\\', '/')).toContain('node_modules/tsx/dist/cli.mjs');
  });
});
