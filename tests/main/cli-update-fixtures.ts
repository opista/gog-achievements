import { sha256 } from '../../src/main/cli-package';
import { packageSpec } from '../../src/main/cli-updates/release-client';

interface ZipEntry {
  name: string;
  bytes: string | Buffer;
  mode?: number;
}
function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function fixtureZip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name);
    const bytes = Buffer.from(item.bytes);
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(0x0314, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(((item.mode ?? 0o100644) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    local.push(header, name, bytes);
    central.push(record, name);
    offset += header.length + name.length + bytes.length;
  }
  const index = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}

export function cliPackage(version = '0.6.0', target = 'macos-arm64', extra: ZipEntry[] = []) {
  const spec = packageSpec(version, target, '0'.repeat(64));
  const prefix = spec.archive.slice(0, -4) + '/';
  const files: ZipEntry[] = [
    {
      name: 'build.json',
      bytes: JSON.stringify({ ...spec, runtime_included: true, native_helper_included: true }),
    },
    {
      name: spec.platform === 'win32' ? 'gog-achievements.exe' : 'gog-achievements',
      bytes: 'fixture executable',
      mode: 0o100755,
    },
    ...['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/NODE-LICENSE.txt'].map((name) => ({
      name,
      bytes: 'fixture license',
    })),
    ...(target === 'macos-x64'
      ? ['lib/node', 'lib/main.cjs', 'native/bin/gog-login'].map((name) => ({
          name,
          bytes: 'fixture runtime',
          mode: 0o100755,
        }))
      : []),
    ...extra,
  ];
  const bytes = fixtureZip(files.map((file) => ({ ...file, name: prefix + file.name })));
  return { bytes, sha256: sha256(bytes), release: { version, archive: spec.archive } };
}

export function releaseMetadata(version = '0.6.0', target = 'macos-arm64') {
  const archive = `gog-achievements-${version}-${target}.zip`;
  return {
    draft: false,
    prerelease: false,
    tag_name: 'v' + version,
    published_at: '2026-10-18T12:00:00Z',
    assets: [archive, `${archive}.sha256`].map((name) => ({ name, state: 'uploaded', size: 100 })),
  };
}

export function helpFixture(version = '0.6.0') {
  return {
    ok: true,
    data: {
      name: 'gog-achievements',
      version,
      common_flags: ['--json', '--pretty', '--help'],
      exit_codes: Object.fromEntries(
        ['0', '2', '3', '4', '5', '6', '7'].map((code) => [code, 'fixture']),
      ),
      commands: Object.entries({
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
      }).map(([command, flags]) => ({ command, flags })),
    },
  };
}
