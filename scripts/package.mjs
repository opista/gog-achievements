import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { writeArtifactChecksums } from './artifact-checksums.mjs';
import {
  downloadCli,
  isMain,
  parseTargetArguments,
  PROJECT_ROOT,
  readReleaseLock,
  selectTarget,
  TARGETS,
} from './cli-artifacts.mjs';
import { smokeCli } from './smoke-cli.mjs';

const execute = promisify(execFile);
const VITE_SCRIPT = 'electron-vite/bin/electron-vite.js';
const BUILDER_SCRIPT = 'electron-builder/cli.js';
const COMPILE_TIMEOUT_MS = 3 * 60 * 1000;
const PACKAGE_TIMEOUT_MS = 10 * 60 * 1000;

export function packageCommands(name, compileOnly = false) {
  const target = TARGETS[selectTarget(name)];
  const commands = [[VITE_SCRIPT, ['build']]];
  if (!compileOnly)
    commands.push([
      BUILDER_SCRIPT,
      [
        target.platform === 'darwin' ? '--mac' : '--win',
        '--' + target.architecture,
        '--publish',
        'never',
        '--config',
        'electron-builder.config.cjs',
      ],
    ]);
  return commands;
}

export async function runPackageCommand(
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
        env: { ...process.env, GOG_CLI_TARGET: target },
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

export async function main(args = process.argv.slice(2)) {
  const options = parseTargetArguments(args, { allowCompileOnly: true });
  if (options.help) {
    process.stdout.write(
      'Usage: npm run package -- [--target TARGET]\n' +
        'Build one native package with its pinned CLI. npm run build compiles only.\n' +
        'Targets: ' +
        Object.keys(TARGETS).join(', ') +
        '\n',
    );
    return;
  }
  const name = selectTarget(options.target, process, true);
  const directory = await downloadCli(name);
  await smokeCli(directory, await readReleaseLock(), name);
  for (const command of packageCommands(name, options.compileOnly))
    await runPackageCommand(name, command);
  if (!options.compileOnly) {
    const { version } = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'));
    const names = await writeArtifactChecksums(join(PROJECT_ROOT, 'dist'), version, name);
    process.stdout.write('SHA-256 checksums written for ' + names.join(', ') + '.\n');
  }
}

if (isMain(import.meta.url))
  main().catch((error) => {
    process.stderr.write('Package build failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
