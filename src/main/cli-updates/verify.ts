import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { cleanEnvironment } from '../cli-client';

const execute = promisify(execFile);
const helpSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    name: z.literal('gog-achievements'),
    version: z.string(),
    common_flags: z.array(z.string()),
    exit_codes: z.record(z.string(), z.string()),
    commands: z.array(z.object({ command: z.string(), flags: z.array(z.string()) })),
  }),
});
const REQUIRED_COMMANDS: Record<string, readonly string[]> = {
  doctor: [],
  'auth login': [],
  'auth status': [],
  'auth logout': [],
  'games list': [],
  'achievements list': ['game'],
  'queue create': ['file', 'game', 'achievement', 'unlocked-at', 'action'],
  'queue add': ['file', 'achievement', 'unlocked-at', 'action'],
  'queue remove': ['file', 'achievement'],
  'queue set-date': ['file', 'achievement', 'unlocked-at'],
  'queue show': ['file'],
  'queue apply': ['file', 'yes', 'dry-run'],
};

export function verifyHelpContract(stdout: string, version: string): void {
  const { data } = helpSchema.parse(JSON.parse(stdout));
  assert.equal(data.version, version);
  assert.ok(data.common_flags.includes('--json'));
  for (const code of ['0', '2', '3', '4', '5', '6', '7']) assert.ok(data.exit_codes[code]);
  for (const [command, flags] of Object.entries(REQUIRED_COMMANDS)) {
    const matches = data.commands.filter((entry) => entry.command === command);
    assert.equal(matches.length, 1);
    assert.ok(flags.every((flag) => matches[0]!.flags.includes(flag)));
  }
}

export type ContractRun = (
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
    windowsHide: boolean;
  },
) => Promise<{ stdout: string; stderr: string }>;

/** These two commands are offline. Never use auth, doctor or apply to test an update. */
export async function verifyCliContract(
  executable: string,
  version: string,
  run: ContractRun = execute,
): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'gog-cli-update-check-'));
  const options = {
    cwd: temporary,
    env: cleanEnvironment(process.env),
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  };
  try {
    const help = await run(executable, ['--help', '--json'], options);
    assert.equal(help.stderr, '');
    verifyHelpContract(help.stdout, version);
    const queue = {
      schema_version: 1,
      user_id: '123',
      game: { id: '456', title: 'Offline update check', client_id: '789' },
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
      items: [
        {
          achievement_id: '101',
          key: 'OFFLINE_UNLOCK',
          name: 'Unlock',
          unlocked_at: '2020-01-01T00:00:00Z',
        },
        {
          achievement_id: '102',
          key: 'OFFLINE_LOCK',
          name: 'Lock',
          action: 'lock',
          previous_unlocked_at: '2020-02-01T12:34:56.123456+0000',
        },
      ],
    };
    const file = join(temporary, 'queue with spaces.json');
    await writeFile(file, JSON.stringify(queue), { flag: 'wx', mode: 0o600 });
    const result = await run(executable, ['queue', 'show', '--file', file, '--json'], options);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, data: queue });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
