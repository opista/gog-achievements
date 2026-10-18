import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { PROJECT_ROOT } from './build-targets.mjs';

const execute = promisify(execFile);
export const COMPILE_COMMAND = ['electron-vite/bin/electron-vite.js', ['build']];
export const BUILDER_SCRIPT = 'electron-builder/cli.js';
const COMPILE_TIMEOUT_MS = 3 * 60 * 1000;
const PACKAGE_TIMEOUT_MS = 10 * 60 * 1000;

export async function runBuildCommand(
  target,
  [script, arguments_],
  { run = execute, stdout = process.stdout, stderr = process.stderr } = {},
) {
  const timeout = script === BUILDER_SCRIPT ? PACKAGE_TIMEOUT_MS : COMPILE_TIMEOUT_MS;
  try {
    const result = await run(
      process.execPath,
      [join(PROJECT_ROOT, 'node_modules', script), ...arguments_],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, ...(target ? { GOG_CLI_TARGET: target } : {}) },
        timeout,
        maxBuffer: 5_000_000,
        windowsHide: true,
      },
    );
    stdout.write(result.stdout);
    stderr.write(result.stderr);
  } catch (error) {
    if (typeof error.stdout === 'string') stdout.write(error.stdout);
    if (typeof error.stderr === 'string') stderr.write(error.stderr);
    if (error.killed && error.code === null && error.signal === 'SIGTERM')
      stderr.write(`${script} timed out after ${timeout / 1000} seconds.\n`);
    throw error;
  }
}
