import { resolve } from 'node:path';

const LOCAL_ENTRYPOINTS = {
  tsx: ['node_modules', 'tsx', 'dist', 'cli.mjs'],
  vite: ['node_modules', 'vite', 'bin', 'vite.js'],
} as const;

export interface LocalCommandOptions {
  cwd: string;
  nodeExecutable: string;
}

export interface LocalCommand {
  executable: string;
  args: string[];
}

export function resolveLocalCommand(
  command: keyof typeof LOCAL_ENTRYPOINTS,
  options: LocalCommandOptions,
): LocalCommand {
  const entrypoint = resolve(options.cwd, ...LOCAL_ENTRYPOINTS[command]);
  return {
    executable: options.nodeExecutable,
    args: [entrypoint],
  };
}
