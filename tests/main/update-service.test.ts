import { expect, it, vi } from 'vitest';
import { UpdateService } from '../../src/main/update-service';

const REPOSITORY = 'metacurb/gog-achievements';
const TARGETS = [
  ['darwin', 'arm64', 'macos-arm64.dmg'],
  ['darwin', 'x64', 'macos-x64.dmg'],
  ['win32', 'arm64', 'windows-arm64.exe'],
  ['win32', 'x64', 'windows-x64.exe'],
] as const;

function release(version = '1.10.0', repository = REPOSITORY) {
  const tag = `v${version}`;
  return {
    id: 42,
    url: `https://api.github.com/repos/${repository}/releases/42`,
    html_url: `https://github.com/${repository}/releases/tag/${tag}`,
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: TARGETS.map(([, , suffix]) => {
      const name = `gog-achievements-${version}-${suffix}`;
      return {
        name,
        state: 'uploaded',
        size: 1024,
        browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
      };
    }),
  };
}

function fixture(
  options: Partial<ConstructorParameters<typeof UpdateService>[0]> = {},
  payload = release(),
) {
  const fetch = vi
    .fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockImplementation(async () => Response.json(payload));
  const openExternal = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
  const service = new UpdateService({
    currentVersion: '1.9.0',
    repository: REPOSITORY,
    platform: 'darwin',
    architecture: 'arm64',
    fetch,
    openExternal,
    ...options,
  });
  return { service, fetch, openExternal };
}

it.each(TARGETS)(
  'selects the exact %s/%s installer and opens it only after an explicit action',
  async (platform, architecture, suffix) => {
    const { service, fetch, openExternal } = fixture({ platform, architecture });
    expect(await service.openDownload()).toBe(false);
    const result = await service.check();
    expect(result.status).toBe('available');
    expect(result.currentVersion).toBe('1.9.0');
    expect(result.latestVersion).toBe('1.10.0');
    expect(result.downloadUrl).toBe(
      `https://github.com/${REPOSITORY}/releases/download/v1.10.0/gog-achievements-1.10.0-${suffix}`,
    );
    expect(openExternal).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual', credentials: 'omit' });
    expect(JSON.stringify(fetch.mock.calls[0]?.[1].headers)).not.toMatch(
      /authorization|token|cookie/i,
    );
    expect(await service.openDownload()).toBe(true);
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(result.downloadUrl);
  },
);

it.each([
  ['1.9.0', '1.10.0', 'available'],
  ['2.9.0', '10.0.0', 'available'],
  ['1.10.0', '1.10.0', 'up-to-date'],
  ['10.0.0', '2.9.0', 'up-to-date'],
  ['1.9007199254740992.0', '1.9007199254740993.0', 'available'],
])('compares numeric stable versions %s and %s', async (currentVersion, latest, status) => {
  const { service } = fixture({ currentVersion }, release(latest));
  expect((await service.check()).status).toBe(status);
});

it.each(['linux', 'freebsd'])(
  'does not request releases for unsupported platform %s',
  async (platform) => {
    const { service, fetch } = fixture({ platform });
    expect((await service.check()).status).toBe('unsupported-target');
    expect(fetch).not.toHaveBeenCalled();
  },
);

it('rejects unsupported architectures and invalid local configuration without a request', async () => {
  for (const options of [
    { architecture: 'ia32' },
    { currentVersion: '1.0.0-beta.1' },
    { repository: '../private' },
  ]) {
    const { service, fetch } = fixture(options);
    expect(['unavailable', 'unsupported-target']).toContain((await service.check()).status);
    expect(fetch).not.toHaveBeenCalled();
  }
});

it('reports private or missing public releases as no-release, never up-to-date', async () => {
  const { service, fetch } = fixture();
  fetch.mockResolvedValue(new Response('private metadata', { status: 404 }));
  const result = await service.check();
  expect(result.status).toBe('no-release');
  expect(result.message).toMatch(/No public release/);
  expect(await service.openDownload()).toBe(false);
});

it.each([403, 429, 500])('handles HTTP %s without exposing response data', async (status) => {
  const { service, fetch } = fixture();
  fetch.mockResolvedValue(new Response('fixture-secret-token', { status }));
  const result = await service.check();
  expect(result.status).toBe('unavailable');
  expect(JSON.stringify(result)).not.toContain('fixture-secret-token');
});

it.each(['draft', 'prerelease', 'tag', 'identity', 'assets'] as const)(
  'rejects invalid %s release metadata',
  async (kind) => {
    const payload = release();
    if (kind === 'draft') payload.draft = true;
    if (kind === 'prerelease') payload.prerelease = true;
    if (kind === 'tag') payload.tag_name = 'v1.10.0-rc.1';
    if (kind === 'identity') payload.id = 99;
    if (kind === 'assets') payload.assets = [];
    const { service } = fixture({}, payload);
    expect((await service.check()).status).toBe('unavailable');
    expect(await service.openDownload()).toBe(false);
  },
);

it.each([
  'http://github.com/metacurb/gog-achievements/releases/download/v1.10.0/gog-achievements-1.10.0-macos-arm64.dmg',
  'https://github.com.evil.test/metacurb/gog-achievements/releases/download/v1.10.0/gog-achievements-1.10.0-macos-arm64.dmg',
  'https://github.com@evil.test/metacurb/gog-achievements/releases/download/v1.10.0/gog-achievements-1.10.0-macos-arm64.dmg',
  'https://github.com/other/repository/releases/download/v1.10.0/gog-achievements-1.10.0-macos-arm64.dmg',
  'https://github.com/metacurb/gog-achievements/releases/download/v1.10.0/gog-achievements-1.10.0-macos-x64.dmg',
  'https://github.com/metacurb/gog-achievements/releases/download/v1.10.0/%2e%2e/installer.dmg',
  'javascript:alert(1)',
])('rejects hostile or mismatched installer URL %s', async (url) => {
  const payload = release();
  payload.assets[0]!.browser_download_url = url;
  const { service, openExternal } = fixture({}, payload);
  expect((await service.check()).status).toBe('unavailable');
  expect(await service.openDownload()).toBe(false);
  expect(openExternal).not.toHaveBeenCalled();
});

it('rejects a foreign release page, foreign API identity and duplicate installer', async () => {
  const payloads = [release(), release(), release()];
  payloads[0]!.html_url = 'https://evil.test/releases/tag/v1.10.0';
  payloads[1]!.url = 'https://api.github.com/repos/other/repository/releases/42';
  payloads[2]!.assets.push({ ...payloads[2]!.assets[0]! });
  for (const payload of payloads)
    expect((await fixture({}, payload).service.check()).status).toBe('unavailable');
});

it.each([
  'https://api.github.com/repos/opista/gog-achievements/releases/latest',
  'https://api.github.com/repositories/123/releases/latest',
  '/repos/opista/gog-achievements/releases/latest',
])('follows a trusted repository transfer through %s', async (location) => {
  const { service, fetch, openExternal } = fixture();
  fetch.mockResolvedValueOnce(new Response(null, { status: 301, headers: { location } }));
  fetch.mockResolvedValueOnce(Response.json(release('1.10.0', 'opista/gog-achievements')));
  const result = await service.check();
  expect(result.status).toBe('available');
  expect(result.releaseUrl).toBe('https://github.com/opista/gog-achievements/releases/tag/v1.10.0');
  expect(await service.openDownload()).toBe(true);
  expect(openExternal.mock.calls[0]?.[0]).toContain(
    'https://github.com/opista/gog-achievements/releases/download/',
  );
});

it('does not follow redirects away from the GitHub release API', async () => {
  const { service, fetch } = fixture();
  fetch.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: 'https://evil.test/release' } }),
  );
  expect((await service.check()).status).toBe('unavailable');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('bounds redirect chains and rejects malformed or oversized bodies', async () => {
  const redirect = fixture();
  redirect.fetch.mockImplementation(
    async () =>
      new Response(null, {
        status: 301,
        headers: { location: `https://api.github.com/repos/${REPOSITORY}/releases/latest` },
      }),
  );
  expect((await redirect.service.check()).status).toBe('unavailable');
  expect(redirect.fetch).toHaveBeenCalledTimes(4);
  for (const response of [
    new Response('not-json'),
    new Response('{}', { headers: { 'content-length': '2000000' } }),
    new Response('x'.repeat(1_048_577)),
  ]) {
    const { service, fetch } = fixture();
    fetch.mockResolvedValueOnce(response);
    expect((await service.check()).status).toBe('unavailable');
  }
});

it('times out fetches that ignore cancellation and never restores a late download URL', async () => {
  const { service, fetch, openExternal } = fixture({ timeoutMs: 10 });
  let finish!: (response: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  expect((await service.check()).status).toBe('unavailable');
  expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(true);
  finish(Response.json(release()));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await service.openDownload()).toBe(false);
  expect(openExternal).not.toHaveBeenCalled();
});

it('bounds a stalled response body and cancels its stream', async () => {
  const cancel = vi.fn();
  const { service, fetch } = fixture({ timeoutMs: 10 });
  fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
  expect((await service.check()).status).toBe('unavailable');
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('coalesces checks and clears a previous URL when a later check fails', async () => {
  const { service, fetch } = fixture();
  const first = service.check();
  expect(service.check()).toBe(first);
  expect((await first).status).toBe('available');
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect((await service.check()).status).toBe('no-release');
  expect(await service.openDownload()).toBe(false);
});

it('reports a failed browser launch without throwing or accepting a caller URL', async () => {
  const { service, openExternal } = fixture();
  await service.check();
  openExternal.mockRejectedValueOnce(new Error('Browser unavailable'));
  expect(await service.openDownload()).toBe(false);
  expect(openExternal).toHaveBeenCalledTimes(1);
});
