import { isMain, parseTargetArguments, selectTarget } from './build-targets.mjs';
import { COMPILE_COMMAND, runBuildCommand } from './build-command.mjs';

export async function main(
  args = process.argv.slice(2),
  { host = process, runCommand = runBuildCommand, stdout = process.stdout } = {},
) {
  const options = parseTargetArguments(args);
  if (options.help) {
    stdout.write(
      'Usage: npm run build -- [--target TARGET]\n' +
        'Compile the app without downloading or running the CLI.\n' +
        'No target is needed. An explicit target must match the host OS and Node architecture.\n',
    );
    return;
  }
  // Compilation is portable. Retain native validation for existing explicit-target callers.
  const target =
    options.target === undefined ? undefined : selectTarget(options.target, host, true);
  await runCommand(target, COMPILE_COMMAND);
}

if (isMain(import.meta.url))
  main().catch((error) => {
    process.stderr.write('App build failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
