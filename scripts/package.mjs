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
import { main as build } from './build.mjs';
import { COMPILE_COMMAND, BUILDER_SCRIPT, runBuildCommand } from './build-command.mjs';
export { runBuildCommand as runPackageCommand } from './build-command.mjs';

export function packageCommands(name, compileOnly = false) {
  const target = TARGETS[selectTarget(name)];
  const commands = [COMPILE_COMMAND];
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

export async function main(
  args = process.argv.slice(2),
  {
    host = process,
    download = downloadCli,
    smoke = smokeCli,
    readLock = readReleaseLock,
    runCommand = runBuildCommand,
    checksums = writeArtifactChecksums,
    stdout = process.stdout,
  } = {},
) {
  const options = parseTargetArguments(args, { allowCompileOnly: true });
  if (options.compileOnly) {
    return build(
      args.filter((argument) => argument !== '--compile-only'),
      { host, runCommand, stdout },
    );
  }
  if (options.help) {
    stdout.write(
      'Usage: npm run package -- [--target TARGET]\n' +
        'Build one native package with its pinned CLI. npm run build compiles only.\n' +
        'Targets: ' +
        Object.keys(TARGETS).join(', ') +
        '\n',
    );
    return;
  }
  const name = selectTarget(options.target, host, true);
  const directory = await download(name);
  await smoke(directory, await readLock(), name);
  for (const command of packageCommands(name)) await runCommand(name, command);
  const { version } = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const names = await checksums(join(PROJECT_ROOT, 'dist'), version, name);
  stdout.write('SHA-256 checksums written for ' + names.join(', ') + '.\n');
}

if (isMain(import.meta.url))
  main().catch((error) => {
    process.stderr.write('Package build failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
