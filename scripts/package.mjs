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

export function packageCommands(name, compileOnly = false) {
  const target = TARGETS[selectTarget(name)];
  const commands = [['electron-vite/bin/electron-vite.js', ['build']]];
  if (!compileOnly)
    commands.push([
      'electron-builder/cli.js',
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
  for (const [script, arguments_] of packageCommands(name, options.compileOnly)) {
    const result = await execute(
      process.execPath,
      [join(PROJECT_ROOT, 'node_modules', script), ...arguments_],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, GOG_CLI_TARGET: name },
        timeout: 180000,
        maxBuffer: 5_000_000,
        windowsHide: true,
      },
    );
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
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
