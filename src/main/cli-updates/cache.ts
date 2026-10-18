import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ARCHIVE_LIMITS, extractCliPackage, sha256, validateCliPackage } from '../cli-package';
import { compatibleVersion, packageSpec, stableVersion } from './release-client';

const version = z
  .string()
  .max(80)
  .refine((value) => stableVersion(value) !== null);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z
  .object({
    path: z.string().min(1).max(512),
    size: z.number().int().min(0).max(ARCHIVE_LIMITS.fileBytes),
    sha256: digest,
    executable: z.boolean(),
  })
  .strict();
const recordSchema = z
  .object({
    version,
    sha256: digest,
    files: z.array(fileSchema).min(1).max(ARCHIVE_LIMITS.entries),
  })
  .strict();
const stateSchema = z
  .object({
    schema_version: z.literal(1),
    automatic: z.boolean(),
    preferBundled: z.boolean(),
    active: recordSchema.nullable(),
    previous: recordSchema.nullable(),
    staged: recordSchema.nullable(),
    rejected: z.array(version).max(32),
  })
  .strict();

export type CachedCli = z.infer<typeof recordSchema>;
export type CliCacheState = z.infer<typeof stateSchema>;

export function initialState(): CliCacheState {
  return {
    schema_version: 1,
    automatic: true,
    preferBundled: false,
    active: null,
    previous: null,
    staged: null,
    rejected: [],
  };
}

function safePath(path: string): boolean {
  return (
    !/[\\:]/.test(path) &&
    [...path].every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    ) &&
    path
      .split('/')
      .every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}

/** A file manifest covers every extracted file, including the private Intel runtime. */
async function manifest(directory: string) {
  const files: CachedCli['files'] = [];
  const seen = new Set<string>();
  let total = 0;
  async function walk(relative: string, depth: number): Promise<void> {
    if (depth > 16) throw new Error('CLI cache nesting exceeds the limit.');
    const stat = await lstat(join(directory, relative));
    if (stat.isSymbolicLink()) throw new Error('CLI cache contains a link.');
    if (stat.isDirectory()) {
      const entries = await readdir(join(directory, relative));
      if (entries.length > ARCHIVE_LIMITS.entries) throw new Error('CLI cache has too many files.');
      for (const entry of entries) {
        const path = relative ? `${relative}/${entry}` : entry;
        const key = path.normalize('NFC').toLowerCase();
        if (!safePath(path) || seen.has(key) || seen.size >= ARCHIVE_LIMITS.entries)
          throw new Error('CLI cache contains an unsafe path.');
        seen.add(key);
        await walk(path, depth + 1);
      }
    } else {
      total += stat.size;
      if (
        !stat.isFile() ||
        stat.size > ARCHIVE_LIMITS.fileBytes ||
        total > ARCHIVE_LIMITS.totalBytes
      )
        throw new Error('CLI cache exceeds the size limit.');
      const bytes = await readFile(join(directory, relative));
      if (bytes.length !== stat.size) throw new Error('CLI cache changed during verification.');
      files.push({
        path: relative,
        size: stat.size,
        sha256: sha256(bytes),
        executable: Boolean(stat.mode & 0o111),
      });
    }
  }
  await walk('', 0);
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export class CliCache {
  private readonly root: string;
  constructor(
    private readonly userDataPath: string,
    readonly target: string,
  ) {
    this.root = join(userDataPath, 'cli-updates', target);
  }

  async ensure(): Promise<void> {
    for (const directory of [
      this.userDataPath,
      join(this.userDataPath, 'cli-updates'),
      this.root,
      join(this.root, 'packages'),
    ]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Unsafe CLI cache directory.');
    }
  }

  private packageRoot(record: CachedCli): string {
    recordSchema.parse(record);
    return join(this.root, 'packages', `${record.version}-${record.sha256}`);
  }

  directory(record: CachedCli): string {
    // Retain the CLI's existing desktop-managed installation marker.
    return join(this.packageRoot(record), 'resources', 'cli');
  }

  async load(): Promise<CliCacheState> {
    await this.ensure();
    const path = join(this.root, 'state.json');
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
        throw new Error('Invalid CLI update state.');
      return stateSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initialState();
      throw error;
    }
  }

  async save(state: CliCacheState): Promise<void> {
    stateSchema.parse(state);
    await this.ensure();
    const temporary = join(this.root, `.${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(state));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, join(this.root, 'state.json'));
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async verify(record: CachedCli): Promise<string> {
    const directory = this.directory(record);
    if (record.files.some((file) => !safePath(file.path))) throw new Error('Invalid CLI manifest.');
    const actual = await manifest(this.packageRoot(record));
    if (JSON.stringify(actual) !== JSON.stringify(record.files))
      throw new Error('CLI cache integrity check failed.');
    await validateCliPackage(directory, packageSpec(record.version, this.target, record.sha256));
    return directory;
  }

  async install(bytes: Buffer, version: string, expected: string): Promise<CachedCli> {
    if (!compatibleVersion(version)) throw new Error('Incompatible CLI version.');
    await this.ensure();
    const staging = await mkdtemp(join(this.root, 'packages', '.download-'));
    await chmod(staging, 0o700);
    try {
      await extractCliPackage(
        bytes,
        join(staging, 'resources', 'cli'),
        packageSpec(version, this.target, expected),
      );
      const record: CachedCli = { version, sha256: expected, files: await manifest(staging) };
      const destination = this.packageRoot(record);
      try {
        await lstat(destination);
        // Reuse an identical package left by an interrupted staging operation.
        await this.verify(record);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await rename(staging, destination);
      }
      return record;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async prune(keep: readonly CachedCli[]): Promise<void> {
    const retained = new Set(keep.map((record) => this.packageRoot(record)));
    const packages = join(this.root, 'packages');
    for (const name of await readdir(packages)) {
      const path = join(packages, name);
      if (retained.has(path) || !/^(?:\d+\.\d+\.\d+-[a-f0-9]{64}|\.download-[\w-]+)$/.test(name))
        continue;
      const stat = await lstat(path);
      if (stat.isDirectory() && !stat.isSymbolicLink())
        await rm(path, { recursive: true, force: true });
    }
  }
}
