import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { join, basename, isAbsolute } from 'node:path';
import { z } from 'zod';
import { DesktopError, cliError } from './errors';
import { CLI_VERSION, CLI_TARGETS } from '../shared/cli-release';

export type CliCommand =
  | { kind: 'help' | 'doctor' | 'auth-status' | 'auth-login' | 'auth-logout' | 'games' }
  | { kind: 'achievements'; gameId: string }
  | {
      kind: 'achievements-export';
      gameId: string;
      file: string;
      search?: string;
      status?: 'all' | 'locked' | 'unlocked';
    }
  | { kind: 'queue-show' | 'queue-preview' | 'queue-apply'; file: string }
  | {
      kind: 'queue-create';
      file: string;
      gameId: string;
      achievementIds: string[];
      action?: 'unlock' | 'lock';
    }
  | { kind: 'queue-add'; file: string; achievementIds: string[]; action?: 'unlock' | 'lock' }
  | { kind: 'queue-remove'; file: string; achievementIds: string[] }
  | { kind: 'queue-date'; file: string; achievementIds: string[]; timestamp: string };
export interface CliOutcome {
  exitCode: number | null;
  result:
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string; details?: unknown } };
}
export interface CliRunOptions {
  /** Cancellation applies only to read commands. Writes and login own their lifecycle. */
  signal?: AbortSignal;
}
export interface CliRunner {
  run(
    command: CliCommand,
    onSpawn?: (pid: number) => Promise<void>,
    options?: CliRunOptions,
  ): Promise<CliOutcome>;
}

// Local mutations can leave files or credentials partly changed when interrupted.
// Login must close its native window itself; apply must preserve its durable process record.
// Only reads receive automatic deadlines or caller cancellation, and no command is retried.
export const CLI_READ_TIMEOUTS = Object.freeze({
  help: 10_000,
  doctor: 15_000,
  'auth-status': 15_000,
  'queue-show': 15_000,
  games: 180_000,
  achievements: 120_000,
  'queue-preview': 120_000,
});
type ReadCommandKind = keyof typeof CLI_READ_TIMEOUTS;
interface CliProcessPolicy {
  readTimeouts?: Partial<Record<ReadCommandKind, number>>;
  terminationGraceMs?: number;
}

export function commandArgs(command: CliCommand): string[] {
  const plain: Partial<Record<CliCommand['kind'], string[]>> = {
    help: ['--help'],
    doctor: ['doctor'],
    'auth-status': ['auth', 'status'],
    'auth-login': ['auth', 'login'],
    'auth-logout': ['auth', 'logout'],
    games: ['games', 'list'],
  };
  const args = plain[command.kind]
    ? [...plain[command.kind]!]
    : command.kind === 'achievements-export'
      ? ['achievements', 'export', '--game', command.gameId, '--file', command.file]
      : command.kind === 'achievements'
        ? ['achievements', 'list', '--game', command.gameId]
        : [
            'queue',
            command.kind
              .replace('queue-', '')
              .replace('preview', 'apply')
              .replace('date', 'set-date'),
            '--file',
            'file' in command ? command.file : '',
          ];
  if (
    'gameId' in command &&
    command.kind !== 'achievements' &&
    command.kind !== 'achievements-export'
  )
    args.push('--game', command.gameId);
  if ('search' in command && command.search !== undefined) args.push('--search', command.search);
  if ('status' in command && command.status !== undefined) args.push('--status', command.status);
  if ('achievementIds' in command)
    for (const id of command.achievementIds) args.push('--achievement', id);
  if ('timestamp' in command) args.push('--unlocked-at', command.timestamp);
  if ('action' in command && command.action) args.push('--action', command.action);
  if (command.kind === 'queue-preview') args.push('--dry-run');
  if (command.kind === 'queue-apply') args.push('--yes');
  return [...args, '--json'];
}
const envelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  }),
]);
export function parseOutcome(stdout: string, exitCode: number | null): CliOutcome {
  let result: z.infer<typeof envelopeSchema>;
  try {
    result = envelopeSchema.parse(JSON.parse(stdout));
  } catch {
    throw new DesktopError('INVALID_CLI_OUTPUT', 'The CLI did not return a valid result.');
  }
  if (exitCode === null || (result.ok && exitCode !== 0) || (!result.ok && exitCode === 0))
    throw new DesktopError('INVALID_CLI_EXIT', 'The CLI ended without a confirmed result.');
  return { exitCode, result };
}
export function requireSuccess(outcome: CliOutcome): unknown {
  if (!outcome.result.ok) throw cliError(outcome.result.error.code);
  return outcome.result.data;
}
export function cleanEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !['NODE_OPTIONS', 'NODE_PATH'].includes(key.toUpperCase()),
    ),
  );
}
type SpawnProcess = (
  file: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;
export class CliClient implements CliRunner {
  constructor(
    readonly executable: string,
    private readonly spawnProcess: SpawnProcess = spawn as SpawnProcess,
    private readonly outputLimit = 256 * 1024 * 1024,
    private readonly policy: CliProcessPolicy = {},
  ) {}
  run(
    command: CliCommand,
    onSpawn?: (pid: number) => Promise<void>,
    options: CliRunOptions = {},
  ): Promise<CliOutcome> {
    const read = Object.hasOwn(CLI_READ_TIMEOUTS, command.kind);
    const signal = read ? options.signal : undefined;
    if (signal?.aborted) return Promise.reject(cliError('CLI_READ_CANCELLED'));
    const timeoutMs = read
      ? (this.policy.readTimeouts?.[command.kind as ReadCommandKind] ??
        CLI_READ_TIMEOUTS[command.kind as ReadCommandKind])
      : undefined;
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnProcess(this.executable, commandArgs(command), {
          shell: false,
          windowsHide: true,
          env: cleanEnvironment(process.env),
        });
      } catch {
        reject(new DesktopError('CLI_START_FAILED', 'The bundled CLI could not start.'));
        return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      let exceeded = false;
      let exited = false;
      let closed = false;
      let failure: DesktopError | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let termination: ReturnType<typeof setTimeout> | undefined;
      let spawnRecord: Promise<void> = Promise.resolve();
      let spawnProblem: unknown;
      const closePipesAfterExit = () => {
        // A descendant can inherit a pipe. Release it only after the read child has exited.
        if (!exited || !failure) return;
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      };
      const kill = (signal: NodeJS.Signals) => {
        if (exited || closed) return;
        try {
          child.kill(signal);
        } catch {
          // Keep ownership until close even if the OS rejects a termination request.
        }
      };
      const stop = (problem: DesktopError) => {
        if (!read || closed || failure) return;
        failure = problem;
        chunks.length = 0;
        kill('SIGTERM');
        termination = setTimeout(() => kill('SIGKILL'), this.policy.terminationGraceMs ?? 1000);
        termination.unref();
        closePipesAfterExit();
      };
      const cancel = () => stop(cliError('CLI_READ_CANCELLED'));
      child.once('spawn', () => {
        if (child.pid && onSpawn) {
          const pid = child.pid;
          spawnRecord = Promise.resolve()
            .then(() => onSpawn(pid))
            .catch((error: unknown) => {
              spawnProblem = error;
            });
        }
        // An abort can arrive between spawn() returning and the spawn event.
        if (failure) kill('SIGTERM');
      });
      child.stdout.on('data', (chunk: Buffer) => {
        if (failure) return;
        bytes += chunk.length;
        if (bytes > this.outputLimit) {
          exceeded = true;
          chunks.length = 0;
          stop(
            new DesktopError(
              'CLI_OUTPUT_LIMIT',
              'The CLI result exceeded the capture limit. Check current state before another attempt.',
            ),
          );
        } else if (!exceeded) chunks.push(chunk);
      });
      // Always drain private diagnostics; never pass unvalidated stderr to the renderer.
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => {});
      child.once('error', () => {
        failure ??= new DesktopError('CLI_START_FAILED', 'The bundled CLI could not start.');
      });
      child.once('exit', () => {
        exited = true;
        closePipesAfterExit();
      });
      child.once('close', (code) => {
        closed = true;
        clearTimeout(deadline);
        clearTimeout(termination);
        signal?.removeEventListener('abort', cancel);
        void spawnRecord
          .then(() => {
            if (spawnProblem) throw spawnProblem;
            if (failure) throw failure;
            if (exceeded)
              throw new DesktopError(
                'CLI_OUTPUT_LIMIT',
                'The CLI result exceeded the capture limit. Check current state before another attempt.',
              );
            resolve(parseOutcome(Buffer.concat(chunks).toString('utf8'), code));
          })
          .catch(reject);
      });
      if (timeoutMs !== undefined) {
        deadline = setTimeout(() => stop(cliError('CLI_READ_TIMEOUT')), timeoutMs);
        deadline.unref();
      }
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      child.stdin.end();
    });
  }
}
export async function resolveCli({
  packaged,
  resourcesPath,
  projectPath,
  developmentDirectory,
  platform = process.platform,
  architecture = process.arch,
  version = CLI_VERSION,
}: {
  packaged: boolean;
  resourcesPath: string;
  projectPath: string;
  developmentDirectory?: string;
  platform?: string;
  architecture?: string;
  version?: string;
}): Promise<string> {
  if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(architecture))
    throw new DesktopError('UNSUPPORTED_PLATFORM', 'Use a supported Mac or Windows app package.');
  if (developmentDirectory !== undefined && (packaged || !isAbsolute(developmentDirectory)))
    throw new DesktopError(
      'CLI_PACKAGE_INVALID',
      'A local CLI build requires an absolute directory in development mode.',
    );
  const target = `${platform === 'darwin' ? 'macos' : 'windows'}-${architecture}`;
  const requirement = CLI_TARGETS[target as keyof typeof CLI_TARGETS];
  const folder =
    developmentDirectory ??
    (packaged ? join(resourcesPath, 'cli') : join(projectPath, 'resources', 'cli', target));
  const name = platform === 'win32' ? 'gog-achievements.exe' : 'gog-achievements';
  try {
    const metadata = JSON.parse(await readFile(join(folder, 'build.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    if (
      metadata.version !== version ||
      metadata.platform !== platform ||
      metadata.architecture !== architecture ||
      metadata.layout !== requirement.layout ||
      metadata.runtime_included !== true ||
      metadata.native_helper_included !== true ||
      (metadata.executable !== undefined && metadata.executable !== name) ||
      basename(name) !== name
    )
      throw new Error();
    await access(join(folder, name));
    return join(folder, name);
  } catch {
    throw new DesktopError(
      'CLI_PACKAGE_INVALID',
      'The bundled CLI is missing or does not match this app. Reinstall the app.',
    );
  }
}
