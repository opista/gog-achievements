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
/** The unique snapshot argument identifies an operation even across the Intel launcher exec. */
export class NativeProcessProbe implements ProcessProbe {
  async find(snapshotPath: string, identity?: ProcessIdentity | null): Promise<ProcessCheck> {
    try {
      let candidates: { pid: number; startedAt: string; command: string; name?: string }[];
      if (process.platform === 'win32') {
        const file = join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        );
        const result = await execute(
          file,
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | Select-Object ProcessId,CreationDate,CommandLine,Name | ConvertTo-Json -Compress',
          ],
          // A cold PowerShell/CIM start can exceed three seconds on Windows.
          { timeout: 10000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
        );
        const raw: unknown = JSON.parse(result.stdout || '[]');
        const values = Array.isArray(raw) ? raw : [raw];
        candidates = values
          .filter((value): value is Record<string, unknown> => !!value && typeof value === 'object')
          .map((value) => ({
            pid: Number(value.ProcessId),
            startedAt: typeof value.CreationDate === 'string' ? value.CreationDate : '',
            command: typeof value.CommandLine === 'string' ? value.CommandLine : '',
            name: typeof value.Name === 'string' ? value.Name : '',
          }));
      } else {
        const result = await execute(
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
            value.name?.toLowerCase() === 'gog-achievements.exe'),
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
