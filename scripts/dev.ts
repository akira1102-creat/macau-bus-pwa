import { spawn, type ChildProcess } from 'node:child_process';

import { resolveLocalCommand } from './dev-runtime';

const children: ChildProcess[] = [];
let shuttingDown = false;

function start(command: 'tsx' | 'vite', args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const localCommand = resolveLocalCommand(command, {
    cwd: process.cwd(),
    nodeExecutable: process.execPath,
  });
  const child = spawn(localCommand.executable, [...localCommand.args, ...args], {
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  children.push(child);
  return child;
}

function stopAll(exitCode = 0): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  process.exitCode = exitCode;
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

const api = start('tsx', ['server/index.ts'], {
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: '3001',
});
const forwardedFrontendArgs = process.argv.slice(2);
const frontend = start('vite', forwardedFrontendArgs.length > 0
  ? forwardedFrontendArgs
  : ['--host', '127.0.0.1', '--port', '5173'], {});

for (const child of [api, frontend]) {
  child.once('error', () => stopAll(1));
  child.once('exit', (code) => {
    if (!shuttingDown) {
      stopAll(code ?? 1);
    }
  });
}
