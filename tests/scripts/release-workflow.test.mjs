import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(
  new URL('../../.github/workflows/release.yml', import.meta.url),
  'utf8',
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TAG = 'v0.1.0';
const COMMIT = 'a'.repeat(40);
const REPO = { owner: 'opista', repo: 'gog-achievements' };

function scriptInStep(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `Missing workflow step: ${name}`);
  const block = /^ {10}script: \|\n((?: {12}.*(?:\n|$)|\n)*)/m.exec(workflow.slice(start));
  assert.ok(block, `Missing inline script: ${name}`);
  return new AsyncFunction(
    'github',
    'context',
    'core',
    'process',
    block[1].replace(/^ {12}/gm, ''),
  );
}

const prepare = scriptInStep('Pin the existing draft release tag');
const recheck = scriptInStep('Confirm the release tag still names the built commit');

function draft(overrides = {}) {
  return { id: 42, tag_name: TAG, draft: true, ...overrides };
}

function fixture(options = {}) {
  const { releases, release, tag, releaseId, commit, builtCommit } = {
    releases: [draft()],
    release: draft(),
    tag: TAG,
    releaseId: '42',
    commit: COMMIT,
    builtCommit: COMMIT,
    ...options,
  };
  const outputs = {};
  const calls = { paginate: [], getCommit: [], getRelease: [] };
  const listReleases = () => {
    throw new Error('Release listings must use pagination.');
  };
  const github = {
    paginate: async (method, options) => {
      assert.equal(method, listReleases);
      calls.paginate.push(options);
      return releases;
    },
    rest: {
      repos: {
        listReleases,
        getRelease: async (options) => {
          calls.getRelease.push(options);
          return { data: release };
        },
        getCommit: async (options) => {
          calls.getCommit.push(options);
          return { data: { sha: commit } };
        },
      },
    },
  };
  const args = [
    github,
    { repo: REPO },
    { setOutput: (key, value) => (outputs[key] = value) },
    { env: { RELEASE_TAG: tag, RELEASE_ID: releaseId, RELEASE_COMMIT: builtCommit } },
  ];
  return {
    outputs,
    calls,
    github,
    prepare: () => prepare(...args),
    recheck: () => recheck(...args),
  };
}

test('draft lookup has write permission while the workflow default stays read-only', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  const prepareJob = workflow.split('\n  prepare:\n')[1].split('\n  build:\n')[0];
  assert.match(prepareJob, /^ {4}permissions:\n {6}contents: write$/m);
  assert.match(prepareJob, /^ {6}release-id: \$\{\{ steps\.pin\.outputs\.release-id \}\}$/m);
  assert.match(workflow, /^ {10}RELEASE_ID: \$\{\{ needs\.prepare\.outputs\.release-id \}\}$/m);
});

test('preparation finds the exact draft in a paginated listing and pins its ID and commit', async () => {
  const state = fixture({
    releases: [
      draft({ id: 9, tag_name: 'v0.0.9', draft: false }),
      draft(),
      draft({ id: 43, tag_name: 'v0.2.0' }),
    ],
  });
  await state.prepare();
  assert.deepEqual(state.calls.paginate, [{ ...REPO, per_page: 100 }]);
  assert.deepEqual(state.calls.getCommit, [{ ...REPO, ref: 'refs/tags/' + TAG }]);
  assert.deepEqual(state.outputs, { commit: COMMIT, 'release-id': 42 });
  assert.deepEqual(state.calls.getRelease, []);
});

test('invalid version input is rejected before requesting releases', async (t) => {
  for (const tag of [undefined, '', '0.1.0', '../v0.1.0', 'v0.1.0; echo invalid']) {
    await t.test(String(tag), async () => {
      const state = fixture({ tag });
      await assert.rejects(state.prepare(), /existing version tag/);
      assert.deepEqual(state.calls.paginate, []);
      assert.deepEqual(state.outputs, {});
    });
  }
});

test('a missing, published or duplicate release cannot start a build', async (t) => {
  const cases = [
    ['missing', []],
    ['another tag', [draft({ tag_name: 'v0.2.0' })]],
    ['published', [draft({ draft: false })]],
    ['duplicate', [draft(), draft({ id: 43 })]],
  ];
  for (const [name, releases] of cases) {
    await t.test(name, async () => {
      const state = fixture({ releases });
      await assert.rejects(state.prepare(), /draft release/);
      assert.deepEqual(state.calls.getCommit, []);
      assert.deepEqual(state.outputs, {});
    });
  }
});

test('preparation requires a positive safe release ID and an explicit draft flag', async (t) => {
  const cases = [
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '42', undefined].map((id) => ({ id })),
    ...[undefined, 'true', 1].map((draft) => ({ draft })),
  ];
  for (const override of cases) {
    await t.test(JSON.stringify(override), async () => {
      const state = fixture({ releases: [draft(override)] });
      await assert.rejects(state.prepare(), /valid draft releases/);
      assert.deepEqual(state.calls.getCommit, []);
      assert.deepEqual(state.outputs, {});
    });
  }
});

test('publication rechecks the pinned release by ID and the unchanged tag commit', async () => {
  const state = fixture();
  await state.recheck();
  assert.deepEqual(state.calls.getRelease, [{ ...REPO, release_id: 42 }]);
  assert.deepEqual(state.calls.getCommit, [{ ...REPO, ref: 'refs/tags/' + TAG }]);
  assert.deepEqual(state.calls.paginate, []);
});

test('invalid pinned release IDs are rejected before requesting a release', async (t) => {
  for (const releaseId of ['', '0', '-1', '1.5', '9007199254740992', 'invalid', undefined]) {
    await t.test(String(releaseId), async () => {
      const state = fixture({ releaseId });
      await assert.rejects(state.recheck(), /Invalid pinned release ID/);
      assert.deepEqual(state.calls.getRelease, []);
      assert.deepEqual(state.calls.getCommit, []);
    });
  }
});

test('a changed release identity, tag or draft state blocks publication', async (t) => {
  for (const override of [
    { id: 43 },
    { id: '42' },
    { tag_name: 'v0.2.0' },
    { draft: false },
    { draft: undefined },
    { draft: 'true' },
  ]) {
    await t.test(JSON.stringify(override), async () => {
      const state = fixture({ release: draft(override) });
      await assert.rejects(state.recheck(), /draft release changed/);
      assert.deepEqual(state.calls.getCommit, []);
    });
  }
});

test('a moved tag blocks publication even when the pinned draft still matches', async () => {
  const state = fixture({ commit: 'b'.repeat(40) });
  await assert.rejects(state.recheck(), /release tag moved/);
  assert.equal(state.calls.getCommit.length, 1);
});

test('release API failures cannot produce preparation outputs or pass the final check', async () => {
  const preparation = fixture();
  preparation.github.paginate = async () => {
    throw new Error('Release API unavailable');
  };
  await assert.rejects(preparation.prepare(), /Release API unavailable/);
  assert.deepEqual(preparation.outputs, {});

  const publication = fixture();
  publication.github.rest.repos.getRelease = async () => {
    throw new Error('Release not found');
  };
  await assert.rejects(publication.recheck(), /Release not found/);
  assert.deepEqual(publication.calls.getCommit, []);
});
