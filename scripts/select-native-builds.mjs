import { execFile } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const fastPrefixes = ['src/renderer/', 'tests/renderer/', 'tests/e2e/', 'docs/'];
const fastFiles = new Set([
  '.gitignore',
  '.prettierignore',
  '.prettierrc.json',
  'eslint.config.mjs',
  'LICENSE',
  'playwright.config.ts',
  'vite.web.config.ts',
]);

export function needsNativeBuild(paths) {
  return paths.some((path) => {
    if (
      typeof path !== 'string' ||
      path.includes('\\') ||
      path.split('/').some((part) => !part || part === '.' || part === '..')
    )
      return true;
    // Renderer entry points that connect to Electron need a real desktop check.
    if (path === 'src/renderer/api.ts' || path.startsWith('src/renderer/platform/')) return true;
    return !(
      fastFiles.has(path) ||
      /^[^/]+\.md$/.test(path) ||
      fastPrefixes.some((prefix) => path.startsWith(prefix))
    );
  });
}

export async function changedPaths(base, head, { cwd = process.cwd() } = {}) {
  if (![base, head].every((sha) => typeof sha === 'string' && /^[a-f\d]{40}$/i.test(sha)))
    throw new Error('PR commit identities are unavailable.');
  const { stdout } = await execute(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--'],
    { cwd, timeout: 15000, maxBuffer: 16 * 1024 * 1024 },
  );
  // Disable rename detection so both the old and new paths affect the decision.
  return stdout ? stdout.slice(0, -1).split('\0') : [];
}

export async function nativeBuildPlan({
  packageEnabled = true,
  eventName,
  event,
  compare = changedPaths,
}) {
  if (!packageEnabled)
    return { required: false, reason: 'Native packages are disabled for this run.' };
  if (eventName !== 'pull_request')
    return { required: true, reason: 'Main, release and manual runs require native packages.' };
  try {
    const paths = await compare(event.pull_request.base.sha, event.pull_request.head.sha);
    const required = needsNativeBuild(paths);
    return {
      required,
      reason: required
        ? 'Native-sensitive files changed.'
        : 'Only renderer, browser or documentation files changed.',
    };
  } catch {
    return { required: true, reason: 'PR change detection failed; run native packages.' };
  }
}

async function main() {
  let event;
  try {
    event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    // Missing event data must select full builds for a PR.
  }
  const plan = await nativeBuildPlan({
    packageEnabled: process.env.NATIVE_PACKAGES_ENABLED !== 'false',
    eventName: process.env.GITHUB_EVENT_NAME,
    event,
  });
  await appendFile(process.env.GITHUB_OUTPUT, `native=${plan.required}\n`);
  process.stdout.write(
    `Native builds: ${plan.required ? 'required' : 'skipped'}. ${plan.reason}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    process.stderr.write('Could not write the native build decision.\n');
    process.exitCode = 1;
  });
