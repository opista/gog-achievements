import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { isMain, readReleaseLock, selectTarget, TARGETS } from './cli-artifacts.mjs';
import { smokeCli } from './smoke-cli.mjs';

const execute = promisify(execFile);
const SIGNATURE_TIMEOUT_MS = 30000;

export async function verifyMacSignature(directory) {
  try {
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', resolve(directory)], {
      timeout: SIGNATURE_TIMEOUT_MS,
      maxBuffer: 1_000_000,
    });
  } catch (error) {
    throw new Error('Mac application signature verification failed: ' + error.message, {
      cause: error,
    });
  }
}

export function packageCliPath(directory, name) {
  const target = TARGETS[selectTarget(name)];
  return target.platform === 'darwin'
    ? join(resolve(directory), 'Contents', 'Resources', 'cli')
    : join(resolve(directory), 'resources', 'cli');
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      target: { type: 'string' },
      directory: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(
      'Usage: node scripts/verify-package.mjs --target TARGET --directory APP\n' +
        'APP is the Mac .app bundle or Windows unpacked app directory.\n',
    );
    return;
  }
  if (!values.directory) throw new Error('--directory requires the packaged app directory.');
  const name = selectTarget(values.target, process, true);
  if (TARGETS[name].platform === 'darwin') {
    await verifyMacSignature(values.directory);
    process.stdout.write('Mac application bundle signature checks passed.\n');
  }
  await smokeCli(packageCliPath(values.directory, name), await readReleaseLock(), name);
  process.stdout.write('Packaged CLI offline checks passed for ' + name + '.\n');
}

if (isMain(import.meta.url))
  main().catch((error) => {
    process.stderr.write('Package verification failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
