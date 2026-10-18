import { expect, test, vi } from 'vitest';
import {
  CliReleaseClient,
  compareVersions,
  compatibleVersion,
} from '../../src/main/cli-updates/release-client';
import { cliPackage, releaseMetadata } from './cli-update-fixtures';

const signal = () => new AbortController().signal;

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
  const downloaded = await new CliReleaseClient(request).download(fixture.release, signal());
  expect(downloaded.bytes).toEqual(fixture.bytes);
  expect(downloaded.sha256).toBe(fixture.sha256);
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
    await expect(new CliReleaseClient(request).download(fixture.release, signal())).rejects.toThrow(
      'checksum',
    );
    expect(request).toHaveBeenCalledOnce();
  }
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(`${fixture.sha256}  ${fixture.release.archive}`));
  await expect(
    new CliReleaseClient(request).download(
      { ...fixture.release, digest: '0'.repeat(64) },
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
    new CliReleaseClient(request).download(cliPackage().release, signal()),
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
    new CliReleaseClient(request).download(cliPackage().release, signal()),
  ).rejects.toThrow('large');
  expect(cancel).toHaveBeenCalled();
});
