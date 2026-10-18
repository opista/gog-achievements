// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import {
  CliActivationContext,
  holdCliActivation,
} from '../../../src/renderer/application/cli-activation-guard';
import { Dialog } from '../../../src/renderer/components/Dialog';

afterEach(cleanup);

it('keeps activation blocked across overlapping workflows and dialogs', async () => {
  const api = { setCliActivationBlocked: vi.fn(async (_input: { blocked: boolean }) => {}) };
  const releaseWork = await holdCliActivation(api);
  const view = render(
    <CliActivationContext value={api}>
      <Dialog title="Review" footer={null} onClose={() => {}}>
        Review
      </Dialog>
    </CliActivationContext>,
  );
  await waitFor(() => expect(api.setCliActivationBlocked).toHaveBeenCalledTimes(2));
  releaseWork();
  await waitFor(() => expect(api.setCliActivationBlocked).toHaveBeenCalledTimes(3));
  expect(api.setCliActivationBlocked.mock.calls.every(([input]) => input.blocked)).toBe(true);
  view.unmount();
  await waitFor(() =>
    expect(api.setCliActivationBlocked).toHaveBeenLastCalledWith({ blocked: false }),
  );
});

it('does not start a workflow until the main process acknowledges its activation guard', async () => {
  let acknowledge!: () => void;
  const api = {
    setCliActivationBlocked: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    ),
  };
  let release: (() => void) | undefined;
  const held = holdCliActivation(api).then((done) => {
    release = done;
  });
  await Promise.resolve();
  expect(release).toBeUndefined();
  acknowledge();
  await held;
  expect(release).toBeTypeOf('function');
  release!();
  await Promise.resolve();
  acknowledge();
});
