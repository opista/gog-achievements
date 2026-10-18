import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const TARGETS = Object.freeze({
  'macos-arm64': Object.freeze({ platform: 'darwin', architecture: 'arm64' }),
  'macos-x64': Object.freeze({ platform: 'darwin', architecture: 'x64' }),
  'windows-arm64': Object.freeze({ platform: 'win32', architecture: 'arm64' }),
  'windows-x64': Object.freeze({ platform: 'win32', architecture: 'x64' }),
});
export function selectTarget(name, host = process, requireNative = false) {
  name ??= Object.keys(TARGETS).find(
    (item) => TARGETS[item].platform === host.platform && TARGETS[item].architecture === host.arch,
  );
  if (!name || !Object.hasOwn(TARGETS, name))
    throw new Error('Choose a supported target: ' + Object.keys(TARGETS).join(', ') + '.');
  const target = TARGETS[name];
  if (requireNative && (target.platform !== host.platform || target.architecture !== host.arch))
    throw new Error('Target ' + name + ' requires its OS and matching Node architecture.');
  return name;
}

export function parseTargetArguments(args, { allowAll = false, allowCompileOnly = false } = {}) {
  let target;
  let all = false;
  let help = false;
  let compileOnly = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--target' || argument.startsWith('--target=')) {
      if (target !== undefined) throw new Error('Use --target only once.');
      target = argument === '--target' ? args[++index] : argument.slice(9);
      if (!target || target.startsWith('-')) throw new Error('--target requires a target name.');
    } else if (argument === '--all' && allowAll) all = true;
    else if (argument === '--compile-only' && allowCompileOnly) compileOnly = true;
    else if (argument === '--help' || argument === '-h') help = true;
    else throw new Error('Unknown argument: ' + argument + '. Use --help.');
  }
  if (all && target !== undefined) throw new Error('Choose --all or --target, not both.');
  return { target, all, help, compileOnly };
}

export function isMain(moduleUrl) {
  return !!process.argv[1] && fileURLToPath(moduleUrl) === resolve(process.argv[1]);
}
