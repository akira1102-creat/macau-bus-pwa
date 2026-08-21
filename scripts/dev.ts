import { spawn, type ChildProcess } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const children: ChildProcess[] = [];
let shuttingDown = false;

function start(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(npmCommand, ['--no-install', command, ...args], {
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
const frontend = start('vite', ['--host', '127.0.0.1', '--port', '5173'], {});

for (const child of [api, frontend]) {
  child.once('error', () => stopAll(1));
  child.once('exit', (code) => {
    if (!shuttingDown) {
      stopAll(code ?? 1);
    }
  });
}
