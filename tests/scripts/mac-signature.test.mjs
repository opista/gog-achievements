import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyMacSignature } from '../../scripts/verify-package.mjs';

const execute = promisify(execFile);

test(
  'Mac package verification rejects an unsealed bundle and detects a changed sealed resource',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'gog-signature-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const app = join(root, 'App With Spaces.app');
    const contents = join(app, 'Contents');
    await mkdir(join(contents, 'MacOS'), { recursive: true });
    await mkdir(join(contents, 'Resources'));
    await writeFile(
      join(contents, 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>fixture</string>
<key>CFBundleIdentifier</key><string>com.example.signature-fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>`,
    );
    const source = join(root, 'fixture.c');
    const resource = join(contents, 'Resources', 'example.txt');
    await writeFile(source, 'int main(void) { return 0; }\n');
    await writeFile(resource, 'original resource\n');
    await execute('/usr/bin/clang', [source, '-o', join(contents, 'MacOS', 'fixture')], {
      timeout: 30000,
    });

    await assert.rejects(verifyMacSignature(app), /signature verification failed/);
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', app], { timeout: 30000 });
    await verifyMacSignature(app);

    await writeFile(resource, 'changed after signing\n');
    await assert.rejects(verifyMacSignature(app), /signature verification failed/);
  },
);
