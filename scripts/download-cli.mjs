import {
  downloadCli,
  isMain,
  parseTargetArguments,
  selectTarget,
  TARGETS,
} from './cli-artifacts.mjs';

export async function main(args = process.argv.slice(2)) {
  const options = parseTargetArguments(args, { allowAll: true });
  if (options.help) {
    process.stdout.write(
      'Usage: npm run cli:download -- [--target TARGET | --all]\nTargets: ' +
        Object.keys(TARGETS).join(', ') +
        '\nDefault: current OS and Node architecture.\n',
    );
    return;
  }
  const names = options.all ? Object.keys(TARGETS) : [selectTarget(options.target)];
  for (const name of names) {
    const directory = await downloadCli(name);
    process.stdout.write('Verified CLI ' + name + ': ' + directory + '\n');
  }
}

if (isMain(import.meta.url))
  main().catch((error) => {
    process.stderr.write('CLI download failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
