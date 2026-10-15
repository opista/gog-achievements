import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../../scripts/cli-artifacts.mjs';
import { packageCommands, runPackageCommand } from '../../scripts/package.mjs';

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
