import test from 'node:test';
import assert from 'node:assert/strict';
import { main as build } from '../../scripts/build.mjs';
import { TARGETS } from '../../scripts/build-targets.mjs';

test('compilation needs no native target on Linux, macOS or Windows', async () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const calls = [];
    await build([], {
      host: { platform, arch: 'x64' },
      runCommand: async (...args) => calls.push(args),
    });
    assert.deepEqual(calls, [[undefined, ['electron-vite/bin/electron-vite.js', ['build']]]]);
  }
});

test('existing explicit targets compile only on their matching host', async () => {
  for (const [name, { platform, architecture }] of Object.entries(TARGETS)) {
    const calls = [];
    await build(['--target', name], {
      host: { platform, arch: architecture },
      runCommand: async (...args) => calls.push(args),
    });
    assert.deepEqual(calls, [[name, ['electron-vite/bin/electron-vite.js', ['build']]]]);
    for (const host of [
      { platform: 'linux', arch: architecture },
      { platform, arch: architecture === 'arm64' ? 'x64' : 'arm64' },
    ]) {
      await assert.rejects(
        build(['--target=' + name], {
          host,
          runCommand: () => assert.fail('Invalid target must not start compilation.'),
        }),
        /requires its OS and matching Node architecture/,
      );
    }
  }
});

test('invalid build arguments fail before any command runs', async () => {
  for (const args of [
    ['--target'],
    ['--target=unknown'],
    ['--all'],
    ['--compile-only'],
    ['--target=macos-arm64', '--target=macos-arm64'],
  ]) {
    const calls = [];
    await assert.rejects(build(args, { runCommand: async (...command) => calls.push(command) }));
    assert.deepEqual(calls, []);
  }
});

test('build help runs no command and compile failures propagate', async () => {
  const messages = [];
  await build(['--help'], {
    host: { platform: 'linux', arch: 'x64' },
    stdout: { write: (text) => messages.push(text) },
    runCommand: () => assert.fail('Help must not start compilation.'),
  });
  assert.match(messages.join(''), /without downloading or running the CLI/);
  const failure = new Error('Compilation failed.');
  await assert.rejects(
    build([], {
      runCommand: async () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
});
