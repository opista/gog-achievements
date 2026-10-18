import { access, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  CliReleaseClient,
  compareVersions,
  compatibleVersion,
} from '../../src/main/cli-updates/release-client';
import { cliPackage, releaseMetadata } from './cli-update-fixtures';

const signal = () => new AbortController().signal;
const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function destination() {
  const root = await mkdtemp(join(tmpdir(), 'gog-cli-transfer-'));
  roots.push(root);
  return join(root, 'archive.zip');
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test('all stable 0.x versions at or above the bundled CLI are compatible', () => {
  for (const version of ['0.5.1', '0.6.0', '0.99.999'])
    expect(compatibleVersion(version)).toBe(true);
  for (const version of ['0.5.0', '1.0.0', '0.6.0-beta.1', '0.6.0+build', '0.06.0', '../0.6.0'])
    expect(compatibleVersion(version)).toBe(false);
  expect(compareVersions('0.10.0', '0.9.99')).toBeGreaterThan(0);
});

test('release pagination still finds the newest compatible CLI after 1.x becomes latest', async () => {
  const request = vi.fn<typeof fetch>();
  request.mockResolvedValueOnce(
    new Response(JSON.stringify([releaseMetadata('1.0.0'), releaseMetadata('0.8.0')]), {
      headers: { link: '<https://api.github.com/page=2>; rel="next"' },
    }),
  );
  request.mockResolvedValueOnce(
    new Response(
      JSON.stringify([
        releaseMetadata('0.10.0'),
        { ...releaseMetadata('0.11.0'), draft: true },
        { ...releaseMetadata('0.12.0'), prerelease: true },
        releaseMetadata('0.13.0-beta'),
      ]),
    ),
  );
  expect(await new CliReleaseClient(request).latest('macos-arm64', [], signal())).toMatchObject({
    version: '0.10.0',
  });
  expect(request.mock.calls.map(([url]) => url)).toEqual(
    [1, 2].map(
      (page) =>
        `https://api.github.com/repos/opista/gog-achievements-cli/releases?per_page=100&page=${page}`,
    ),
  );
  expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  expect(request.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
});

test('incomplete, duplicate and rejected release assets are never selected', async () => {
  const incomplete = releaseMetadata('0.9.0');
  incomplete.assets.pop();
  const duplicate = releaseMetadata('0.8.0');
  duplicate.assets.push(duplicate.assets[0]!);
  const unpublished = { ...releaseMetadata('0.7.0'), published_at: null };
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify([
          incomplete,
          duplicate,
          unpublished,
          releaseMetadata('0.6.1'),
          releaseMetadata('0.6.0'),
        ]),
      ),
    );
  expect(
    await new CliReleaseClient(request).latest('macos-arm64', ['0.6.1'], signal()),
  ).toMatchObject({ version: '0.6.0' });
});

test('downloads use the exact public archive and matching named checksum', async () => {
  const fixture = cliPackage();
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(`${fixture.sha256}  ${fixture.release.archive}\n`))
    .mockResolvedValueOnce(new Response(new Uint8Array(fixture.bytes)));
  const path = await destination();
  const downloaded = await new CliReleaseClient(request).download(fixture.release, path, signal());
  expect(await readFile(path)).toEqual(fixture.bytes);
  expect(downloaded).toBe(fixture.sha256);
  if (process.platform !== 'win32') expect((await lstat(path)).mode & 0o777).toBe(0o600);
  expect(request.mock.calls.map(([url]) => url)).toEqual(
    ['.sha256', ''].map(
      (suffix) =>
        `https://github.com/opista/gog-achievements-cli/releases/download/v0.6.0/${fixture.release.archive}${suffix}`,
    ),
  );
});

test('checksum filenames and GitHub asset digests must agree before downloading code', async () => {
  const fixture = cliPackage();
  for (const checksum of [
    `${fixture.sha256}  other.zip`,
    `${fixture.sha256}\n${fixture.sha256}  ${fixture.release.archive}`,
  ]) {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(checksum));
    await expect(
      new CliReleaseClient(request).download(fixture.release, await destination(), signal()),
    ).rejects.toThrow('checksum');
    expect(request).toHaveBeenCalledOnce();
  }
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(`${fixture.sha256}  ${fixture.release.archive}`));
  await expect(
    new CliReleaseClient(request).download(
      { ...fixture.release, digest: '0'.repeat(64) },
      await destination(),
      signal(),
    ),
  ).rejects.toThrow('mismatch');
});

test.each([
  'http://release-assets.githubusercontent.com/a',
  'https://evil.example/a',
  'https://user:pass@github.com/a',
  'https://github.com:444/a',
])('rejects unsafe asset redirect %s', async (location) => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }));
  await expect(
    new CliReleaseClient(request).download(cliPackage().release, await destination(), signal()),
  ).rejects.toThrow('Unsafe');
  expect(request).toHaveBeenCalledOnce();
});

test('metadata redirects cannot change the release authority', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://evil.example/releases' } }),
    );
  await expect(new CliReleaseClient(request).latest('macos-arm64', [], signal())).rejects.toThrow(
    'redirect',
  );
});

test('oversized streams are rejected and cancelled', async () => {
  const cancel = vi.fn();
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(4097));
        },
        cancel,
      }),
    ),
  );
  await expect(
    new CliReleaseClient(request).download(cliPackage().release, await destination(), signal()),
  ).rejects.toThrow('large');
  expect(cancel).toHaveBeenCalled();
});

function archiveRequest(fixture: ReturnType<typeof cliPackage>, response: Response) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(`${fixture.sha256}  ${fixture.release.archive}`))
    .mockResolvedValueOnce(response);
}

test('archives stream without Content-Length and retain exact chunk order', async () => {
  const fixture = cliPackage();
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < fixture.bytes.length; offset += 37)
          controller.enqueue(fixture.bytes.subarray(offset, offset + 37));
        controller.close();
      },
    }),
  );
  expect(response.headers.has('content-length')).toBe(false);
  const path = await destination();
  const client = new CliReleaseClient(archiveRequest(fixture, response));
  await expect(client.download(fixture.release, path, signal())).resolves.toBe(fixture.sha256);
  expect(await readFile(path)).toEqual(fixture.bytes);
});

test.each(['digest', 'stream-size', 'advertised-size'])(
  'failed archive %s removes its partial file',
  async (failure) => {
    const fixture = cliPackage();
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('first chunk'));
          controller.enqueue(Buffer.from('second chunk'));
          if (failure === 'digest') controller.close();
        },
        cancel,
      }),
      { headers: failure === 'advertised-size' ? { 'content-length': '100' } : {} },
    );
    const path = await destination();
    const client = new CliReleaseClient(archiveRequest(fixture, response), {
      archiveBytes: failure === 'digest' ? 100 : 15,
    });
    await expect(client.download(fixture.release, path, signal())).rejects.toThrow(
      failure === 'digest' ? 'SHA-256' : 'large',
    );
    await expect(access(path)).rejects.toThrow();
    if (failure !== 'digest') expect(cancel).toHaveBeenCalledOnce();
  },
);

test('an existing destination is neither overwritten nor removed', async () => {
  const fixture = cliPackage();
  const path = await destination();
  await writeFile(path, 'existing');
  const client = new CliReleaseClient(
    archiveRequest(fixture, new Response(new Uint8Array(fixture.bytes))),
  );
  await expect(client.download(fixture.release, path, signal())).rejects.toThrow();
  expect(await readFile(path, 'utf8')).toBe('existing');
});

test('caller abort cancels a stalled body and removes the archive before returning', async () => {
  const fixture = cliPackage();
  const started = deferred();
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream(
      {
        pull() {
          started.resolve();
        },
        cancel,
      },
      { highWaterMark: 0 },
    ),
  );
  const path = await destination();
  const controller = new AbortController();
  const pending = new CliReleaseClient(archiveRequest(fixture, response)).download(
    fixture.release,
    path,
    controller.signal,
  );
  const rejected = expect(pending).rejects.toThrow('cancelled by test');
  await started.promise;
  controller.abort(new Error('cancelled by test'));
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  await expect(access(path)).rejects.toThrow();
});

test.each(['headers', 'body'])(
  'inactivity bounds stalled %s even when transport ignores abort',
  async (stage) => {
    const fixture = cliPackage();
    const path = await destination();
    const started = deferred();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(`${fixture.sha256}  ${fixture.release.archive}`));
    if (stage === 'headers')
      request.mockImplementationOnce(() => {
        started.resolve();
        return new Promise<Response>(() => {});
      });
    else
      request.mockResolvedValueOnce(
        new Response(
          new ReadableStream(
            {
              pull() {
                started.resolve();
              },
              cancel() {
                return new Promise<void>(() => {});
              },
            },
            { highWaterMark: 0 },
          ),
        ),
      );
    vi.useFakeTimers();
    const pending = new CliReleaseClient(request, {
      inactivityTimeoutMs: 100,
      totalTimeoutMs: 1000,
    }).download(fixture.release, path, signal());
    const rejected = expect(pending).rejects.toThrow('stalled');
    await started.promise;
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    await expect(access(path)).rejects.toThrow();
  },
);

test('continued body progress resets inactivity but cannot exceed the total deadline', async () => {
  const fixture = cliPackage();
  const path = await destination();
  let ready = deferred();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        start(value) {
          controller = value;
        },
        pull() {
          ready.resolve();
        },
      },
      { highWaterMark: 0 },
    ),
  );
  vi.useFakeTimers();
  const client = new CliReleaseClient(archiveRequest(fixture, response), {
    inactivityTimeoutMs: 60,
    totalTimeoutMs: 100,
  });
  const pending = client.download(fixture.release, path, signal());
  const rejected = expect(pending).rejects.toThrow('deadline');
  await ready.promise;
  for (let index = 0; index < 2; index++) {
    await vi.advanceTimersByTimeAsync(40);
    ready = deferred();
    controller.enqueue(new Uint8Array([index]));
    await ready.promise;
  }
  await vi.advanceTimersByTimeAsync(21);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  await expect(access(path)).rejects.toThrow();
});
