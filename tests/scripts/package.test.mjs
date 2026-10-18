import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { PROJECT_ROOT, TARGETS } from '../../scripts/cli-artifacts.mjs';
import { main, packageCommands, runPackageCommand } from '../../scripts/package.mjs';

function output() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    streams: {
      stdout: { write: (text) => stdout.push(text) },
      stderr: { write: (text) => stderr.push(text) },
    },
  };
}

function packageFixture({ host = { platform: 'darwin', arch: 'arm64' }, failAt } = {}) {
  const calls = [];
  const failure = new Error(`${failAt} failed`);
  const directory = join(PROJECT_ROOT, 'fixture-cli');
  const lock = { fixture: 'verified release lock' };
  const captured = output();
  const step = (name, ...args) => {
    calls.push([name, ...args]);
    if (name === failAt) throw failure;
  };
  return {
    calls,
    failure,
    directory,
    lock,
    captured,
    dependencies: {
      host,
      download: async (target) => {
        step('download', target);
        return directory;
      },
      readLock: async () => {
        step('readLock');
        return lock;
      },
      smoke: async (...args) => step('smoke', ...args),
      runCommand: async (target, command) =>
        step(command[0] === 'electron-builder/cli.js' ? 'package' : 'compile', target, command),
      checksums: async (...args) => {
        step('checksums', ...args);
        return ['fixture.zip'];
      },
      stdout: captured.streams.stdout,
    },
  };
}

test('packaging verifies its CLI before compilation and writes checksums after the builder', async () => {
  const { version } = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'));
  for (const [target, { platform, architecture }] of Object.entries(TARGETS)) {
    const fixture = packageFixture({ host: { platform, arch: architecture } });
    await main([`--target=${target}`], fixture.dependencies);
    const [compile, builder] = packageCommands(target);
    assert.deepEqual(fixture.calls, [
      ['download', target],
      ['readLock'],
      ['smoke', fixture.directory, fixture.lock, target],
      ['compile', target, compile],
      ['package', target, builder],
      ['checksums', join(PROJECT_ROOT, 'dist'), version, target],
    ]);
    assert.deepEqual(fixture.captured.stdout, ['SHA-256 checksums written for fixture.zip.\n']);
  }
});

test('packaging rejects an unsupported or mismatched native host before any external work', async () => {
  for (const [args, host] of [
    [[], { platform: 'linux', arch: 'x64' }],
    [['--target=windows-arm64'], { platform: 'darwin', arch: 'arm64' }],
    [['--target=macos-x64'], { platform: 'darwin', arch: 'arm64' }],
  ]) {
    const fixture = packageFixture({ host });
    await assert.rejects(
      main(args, fixture.dependencies),
      /supported target|matching Node architecture/,
    );
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(fixture.captured.stdout, []);
  }
});

const packagingSteps = ['download', 'readLock', 'smoke', 'compile', 'package', 'checksums'];
for (const [index, failAt] of packagingSteps.entries()) {
  test(`a ${failAt} failure stops packaging before later steps`, async () => {
    const fixture = packageFixture({ failAt });
    await assert.rejects(main([], fixture.dependencies), (error) => error === fixture.failure);
    assert.deepEqual(
      fixture.calls.map(([step]) => step),
      packagingSteps.slice(0, index + 1),
    );
    assert.deepEqual(fixture.captured.stdout, []);
  });
}

test('legacy compile-only builds run without CLI setup on Linux or a matching native target', async () => {
  for (const [args, host, target] of [
    [['--compile-only'], { platform: 'linux', arch: 'x64' }, undefined],
    [
      ['--compile-only', '--target=macos-arm64'],
      { platform: 'darwin', arch: 'arm64' },
      'macos-arm64',
    ],
  ]) {
    const fixture = packageFixture({ host });
    await main(args, fixture.dependencies);
    assert.deepEqual(fixture.calls, [
      ['compile', target, ['electron-vite/bin/electron-vite.js', ['build']]],
    ]);
    assert.deepEqual(fixture.captured.stdout, []);
  }
});

test('legacy compile-only builds retain explicit native target validation', async () => {
  const fixture = packageFixture();
  await assert.rejects(
    main(['--compile-only', '--target=windows-arm64'], fixture.dependencies),
    /matching Node architecture/,
  );
  assert.deepEqual(fixture.calls, []);
});

test('packaging gets a bounded ten-minute deadline while compilation retains three minutes', async () => {
  const calls = [];
  const captured = output();
  const run = async (...args) => {
    calls.push(args);
    return { stdout: 'progress\n', stderr: 'warning\n' };
  };
  for (const command of packageCommands('macos-x64'))
    await runPackageCommand('macos-x64', command, { run, ...captured.streams });

  assert.deepEqual(
    calls.map(([, , options]) => options.timeout),
    [180_000, 600_000],
  );
  assert.equal(calls[1][0], process.execPath);
  assert.equal(calls[1][1][0], join(PROJECT_ROOT, 'node_modules', 'electron-builder/cli.js'));
  assert.equal(calls[1][2].cwd, PROJECT_ROOT);
  assert.equal(calls[1][2].env.GOG_CLI_TARGET, 'macos-x64');
  assert.equal(calls[1][2].windowsHide, true);
  assert.deepEqual(captured.stdout, ['progress\n', 'progress\n']);
  assert.deepEqual(captured.stderr, ['warning\n', 'warning\n']);
});

test('a failed child retains both diagnostic streams and its original exit error', async () => {
  const captured = output();
  const execute = promisify(execFile);
  const run = async (_executable, _args, options) =>
    execute(
      process.execPath,
      [
        '-e',
        'process.stdout.write("build progress\\n"); process.stderr.write("build failure\\n"); process.exit(7);',
      ],
      options,
    );
  await assert.rejects(
    runPackageCommand('macos-x64', packageCommands('macos-x64')[1], {
      run,
      ...captured.streams,
    }),
    (error) => error.code === 7 && error.killed === false,
  );
  assert.deepEqual(captured.stdout, ['build progress\n']);
  assert.deepEqual(captured.stderr, ['build failure\n']);
});

test('deadline termination reports the command and limit and still rejects', async () => {
  const captured = output();
  const failure = Object.assign(new Error('stopped'), {
    killed: true,
    code: null,
    signal: 'SIGTERM',
    stdout: 'last progress\n',
    stderr: '',
  });
  await assert.rejects(
    runPackageCommand('macos-x64', packageCommands('macos-x64')[1], {
      run: async () => {
        throw failure;
      },
      ...captured.streams,
    }),
    (error) => error === failure,
  );
  assert.deepEqual(captured.stdout, ['last progress\n']);
  assert.match(captured.stderr.join(''), /electron-builder\/cli.js timed out after 600 seconds/);
});

test('missing output and output-limit failures are not mislabeled as timeouts', async () => {
  for (const failure of [
    new Error('spawn failed'),
    Object.assign(new Error('buffer limit'), {
      killed: true,
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      signal: 'SIGTERM',
      stdout: 'partial output',
    }),
  ]) {
    const captured = output();
    await assert.rejects(
      runPackageCommand('macos-x64', packageCommands('macos-x64')[1], {
        run: async () => {
          throw failure;
        },
        ...captured.streams,
      }),
      (error) => error === failure,
    );
    assert.doesNotMatch(captured.stderr.join(''), /timed out/);
  }
});
