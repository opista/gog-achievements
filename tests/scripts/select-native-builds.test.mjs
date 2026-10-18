import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  changedPaths,
  nativeBuildPlan,
  needsNativeBuild,
} from '../../scripts/select-native-builds.mjs';

const execute = promisify(execFile);
const event = { pull_request: { base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } } };
const plan = (paths, overrides = {}) =>
  nativeBuildPlan({ eventName: 'pull_request', event, compare: async () => paths, ...overrides });

test('renderer, browser and documentation changes keep PRs on the fast checks', async () => {
  const paths = [
    'src/renderer/App.tsx',
    'src/renderer/features/library/use-library.ts',
    'src/renderer/styles.css',
    'tests/renderer/App.test.tsx',
    'tests/e2e/large-library.spec.ts',
    'README.md',
    'CHANGELOG.md',
    'docs/RELEASING.md',
    'docs/design/game-library.png',
    'playwright.config.ts',
    'vite.web.config.ts',
    '.prettierrc.json',
    'eslint.config.mjs',
  ];
  assert.equal((await plan(paths)).required, false);
});

test('native integration, packaging and unknown paths require native builds', async (t) => {
  for (const path of [
    'src/main/index.ts',
    'src/preload/index.ts',
    'src/shared/api.ts',
    'src/renderer/api.ts',
    'src/renderer/platform/desktop-api.ts',
    'package.json',
    'package-lock.json',
    '.node-version',
    'cli-release.lock.json',
    'electron-builder.config.cjs',
    'electron.vite.config.ts',
    'tsconfig.json',
    'build/ui-security.ts',
    'scripts/download-cli.mjs',
    'tests/main/cli-client.test.ts',
    'tests/desktop/ipc.spec.ts',
    '.github/workflows/build.yml',
    'resources/entitlements.mac.plist',
    'resources/ui/assets/app-icon.png',
    'new-packaging-config.toml',
  ]) {
    await t.test(path, async () => {
      assert.equal((await plan(['src/renderer/App.tsx', path])).required, true);
    });
  }
});

test('main, release and manual runs keep full native builds without a diff', async (t) => {
  for (const eventName of ['push', 'workflow_dispatch', 'workflow_call']) {
    await t.test(eventName, async () => {
      let compared = false;
      const result = await plan([], {
        eventName,
        event: undefined,
        compare: async () => {
          compared = true;
          throw new Error('No PR diff');
        },
      });
      assert.equal(result.required, true);
      assert.equal(compared, false);
    });
  }
});

test('disabled native packaging never compares fork PR revisions', async () => {
  const result = await plan([], {
    packageEnabled: false,
    event: undefined,
    compare: async () => {
      throw new Error('Must not compare a fork');
    },
  });
  assert.equal(result.required, false);
});

test('missing event data and failed or invalid comparisons select full native builds', async () => {
  assert.equal((await plan([], { event: undefined })).required, true);
  assert.equal(
    (
      await plan([], {
        compare: async () => {
          throw new Error('Missing history');
        },
      })
    ).required,
    true,
  );
  assert.equal((await plan(undefined)).required, true);
  for (const path of [
    null,
    '../src/renderer/App.tsx',
    'docs/../native.c',
    '/README.md',
    'docs\\native.c',
  ])
    assert.equal(needsNativeBuild([path]), true);
  await assert.rejects(changedPaths('--bad-ref', event.pull_request.head.sha), /commit identities/);
});

test('a native change beyond the first 300 files still requires native builds', async () => {
  const paths = Array.from({ length: 400 }, (_, index) => `src/renderer/view-${index}.tsx`);
  paths.push('src/main/index.ts');
  assert.equal((await plan(paths)).required, true);
});

test('workflow gates PR packages but preserves full main/release builds and the fork guard', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/build.yml', import.meta.url),
    'utf8',
  );
  const packageJob = workflow.split('\n  package:\n')[1];
  const packageIf = packageJob.match(/^ {4}if: (.+)$/m)[1];
  const packageAllowed = new Function('inputs', 'github', 'needs', `return Boolean(${packageIf});`);
  const selectionStep = workflow
    .split('      - name: Select native builds\n')[1]
    .split('      - run: npm ci')[0];
  const selectionIf = selectionStep.match(/^ {8}if: (.+)$/m)[1];
  const selectionAllowed = new Function('inputs', 'github', `return Boolean(${selectionIf});`);
  for (const [eventName, enabled, sameRepo, native, expected] of [
    ['pull_request', true, true, 'false', false],
    ['pull_request', true, true, 'true', true],
    ['pull_request', true, true, undefined, false],
    ['pull_request', true, false, 'true', false],
    ['pull_request', false, false, undefined, false],
    ['push', true, true, undefined, true],
    ['workflow_dispatch', true, true, undefined, true],
    ['push', false, true, undefined, false],
  ]) {
    const inputs = { package: enabled };
    const github = {
      event_name: eventName,
      repository: 'opista/gog-achievements',
      event:
        eventName === 'pull_request'
          ? {
              pull_request: {
                head: {
                  repo: {
                    full_name: sameRepo ? 'opista/gog-achievements' : 'fork/gog-achievements',
                  },
                },
              },
            }
          : {},
    };
    assert.equal(packageAllowed(inputs, github, { checks: { outputs: { native } } }), expected);
    assert.equal(selectionAllowed(inputs, github), enabled && eventName === 'pull_request');
  }
});

test('complete Git comparison and CLI output handle UI changes and native-to-doc renames', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gog-native-selection-'));
  const git = async (...args) =>
    (await execute('git', args, { cwd, timeout: 10000 })).stdout.trim();
  const commit = () =>
    git(
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'fixture',
    );
  try {
    await git('init', '-q');
    for (const path of ['src/main/native.ts', 'src/renderer/New view 雪.tsx', 'docs/guide.md']) {
      await mkdir(dirname(join(cwd, path)), { recursive: true });
      await writeFile(join(cwd, path), 'initial\n');
    }
    await git('add', '.');
    await commit();
    const base = await git('rev-parse', 'HEAD');
    await writeFile(join(cwd, 'src/renderer/New view 雪.tsx'), 'UI change\n');
    await git('add', '.');
    await commit();
    const head = await git('rev-parse', 'HEAD');
    const paths = await changedPaths(base, head, { cwd });
    assert.deepEqual(paths, ['src/renderer/New view 雪.tsx']);
    assert.equal(needsNativeBuild(paths), false);

    const eventPath = join(cwd, 'event.json');
    const outputPath = join(cwd, 'output.txt');
    await writeFile(
      eventPath,
      JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } }),
    );
    await execute(
      process.execPath,
      [fileURLToPath(new URL('../../scripts/select-native-builds.mjs', import.meta.url))],
      {
        cwd,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
          NATIVE_PACKAGES_ENABLED: 'true',
        },
      },
    );
    assert.equal(await readFile(outputPath, 'utf8'), 'native=false\n');

    await rename(join(cwd, 'src/main/native.ts'), join(cwd, 'docs/native-notes.md'));
    await git('add', 'src', 'docs');
    await commit();
    const renamed = await changedPaths(base, await git('rev-parse', 'HEAD'), { cwd });
    assert.ok(renamed.includes('src/main/native.ts'));
    assert.ok(renamed.includes('docs/native-notes.md'));
    assert.equal(needsNativeBuild(renamed), true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
