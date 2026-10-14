import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
const execute = promisify(execFile);
export interface ProcessIdentity {
  pid: number;
  startedAt: string;
}
export type ProcessCheck =
  { state: 'alive'; identity: ProcessIdentity } | { state: 'gone' | 'unknown' };
export interface ProcessProbe {
  find(snapshotPath: string, identity?: ProcessIdentity | null): Promise<ProcessCheck>;
}
interface ProcessCandidate {
  pid: number;
  startedAt: string;
  command: string;
  name?: string;
}
type ProcessExecutor = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; windowsHide?: boolean },
) => Promise<{ stdout: string }>;
interface NativeProcessProbeOptions {
  platform?: NodeJS.Platform;
  execute?: ProcessExecutor;
}
const WINDOWS_QUERY = [
  "$ErrorActionPreference = 'Stop';",
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);',
  '$processes = @(Get-CimInstance -ClassName Win32_Process',
  "-Filter \"Name = 'gog-achievements.exe' OR Name = 'node.exe'\"",
  '-Property ProcessId,CreationDate,CommandLine,Name -ErrorAction Stop',
  '| Select-Object ProcessId,CreationDate,CommandLine,Name);',
  'ConvertTo-Json -InputObject $processes -Compress',
].join(' ');

function parseWindowsProcesses(stdout: string): ProcessCandidate[] {
  const rows: unknown = JSON.parse(stdout);
  if (!Array.isArray(rows)) throw new Error('Expected a process array.');
  return rows.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw new Error('Invalid process entry.');
    const value = row as Record<string, unknown>;
    if (
      !Number.isSafeInteger(value.ProcessId) ||
      Number(value.ProcessId) <= 0 ||
      typeof value.Name !== 'string' ||
      !/^(gog-achievements|node)\.exe$/i.test(value.Name) ||
      typeof value.CreationDate !== 'string' ||
      !value.CreationDate.trim() ||
      (typeof value.CommandLine !== 'string' && value.CommandLine !== null)
    )
      throw new Error('Incomplete process identity.');
    return {
      pid: Number(value.ProcessId),
      startedAt: value.CreationDate,
      command: value.CommandLine ?? '',
      name: value.Name,
    };
  });
}

/** The unique snapshot argument identifies an operation even across the Intel launcher exec. */
export class NativeProcessProbe implements ProcessProbe {
  private readonly platform: NodeJS.Platform;
  private readonly execute: ProcessExecutor;

  constructor(options: NativeProcessProbeOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.execute = options.execute ?? execute;
  }

  async find(snapshotPath: string, identity?: ProcessIdentity | null): Promise<ProcessCheck> {
    try {
      let candidates: ProcessCandidate[];
      if (this.platform === 'win32') {
        const file = join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        );
        const result = await this.execute(
          file,
          ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_QUERY],
          // Filter in CIM so unrelated processes and their properties are not retrieved.
          { timeout: 10000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
        );
        candidates = parseWindowsProcesses(result.stdout);
        if (!candidates.length) return { state: 'gone' };
      } else {
        const result = await this.execute(
          '/bin/ps',
          ['-axww', '-o', 'pid=', '-o', 'lstart=', '-o', 'command='],
          { timeout: 3000, maxBuffer: 2 * 1024 * 1024 },
        );
        candidates = parseUnixProcesses(result.stdout);
      }
      if (!candidates.length) return { state: 'unknown' };
      const obscured = candidates.find(
        (value) =>
          !value.command &&
          ((identity && value.pid === identity.pid) ||
            (this.platform === 'win32' && value.name !== undefined)),
      );
      if (obscured) return { state: 'unknown' };
      const current = candidates.find(
        (value) =>
          value.command.includes(snapshotPath) &&
          value.command.includes('queue apply') &&
          value.command.includes('--yes'),
      );
      if (current && (!Number.isInteger(current.pid) || current.pid <= 0 || !current.startedAt))
        return { state: 'unknown' };
      if (
        current &&
        identity &&
        (current.pid !== identity.pid || current.startedAt !== identity.startedAt)
      )
        return { state: 'unknown' };
      return current
        ? { state: 'alive', identity: { pid: current.pid, startedAt: current.startedAt } }
        : { state: 'gone' };
    } catch {
      return { state: 'unknown' };
    }
  }
}

export function parseUnixProcesses(
  stdout: string,
): { pid: number; startedAt: string; command: string }[] {
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.{24})\s+(.+)$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), startedAt: match[2]!.trim(), command: match[3]! }]
      : [];
  });
}
