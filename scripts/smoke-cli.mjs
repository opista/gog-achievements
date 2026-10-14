import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isMain,
  parseTargetArguments,
  PROJECT_ROOT,
  readReleaseLock,
  selectTarget,
  TARGETS,
  validateDistribution,
} from './cli-artifacts.mjs';

const execute = promisify(execFile);

export async function smokeCli(directory, lock, name, run = execute) {
  selectTarget(name, process, true);
  await validateDistribution(directory, lock, name);
  const executable = join(
    directory,
    'gog-achievements' + (TARGETS[name].platform === 'win32' ? '.exe' : ''),
  );
  const temporary = await mkdtemp(join(tmpdir(), 'gog-desktop-offline-smoke-'));
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const options = { cwd: temporary, env, timeout: 30000, maxBuffer: 1_000_000, windowsHide: true };
  try {
    const help = await run(executable, ['--help', '--json'], options);
    assert.equal(help.stderr, '');
    const info = JSON.parse(help.stdout);
    assert.equal(info.ok, true);
    assert.equal(info.data.version, lock.version);
    assert.equal(info.data.name, 'gog-achievements');
    const queue = {
      schema_version: 1,
      user_id: '123',
      game: { id: '1423049311', title: 'Offline smoke test', client_id: '53652320436400298' },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      items: [],
    };
    const queuePath = join(temporary, 'queue with spaces.json');
    await writeFile(queuePath, JSON.stringify(queue));
    const result = await run(executable, ['queue', 'show', '--file', queuePath, '--json'], options);
    assert.equal(result.stderr, '');
    const outcome = JSON.parse(result.stdout);
    assert.equal(outcome.ok, true);
    assert.deepEqual(outcome.data, queue);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseTargetArguments(args);
  if (options.help) {
    process.stdout.write(
      'Usage: npm run cli:smoke -- [--target TARGET]\nRuns JSON help and an offline queue read only.\n',
    );
    return;
  }
  const name = selectTarget(options.target, process, true);
  await smokeCli(join(PROJECT_ROOT, 'resources', 'cli', name), await readReleaseLock(), name);
  process.stdout.write('Offline CLI smoke checks passed for ' + name + '.\n');
}

if (isMain(import.meta.url))
  main().catch((error) => {
    process.stderr.write('CLI smoke failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
