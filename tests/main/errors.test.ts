import { expect, it } from 'vitest';
import { cliError, DesktopError, publicError } from '../../src/main/errors';

it.each([
  ['INVALID_DATE', /date and time/i],
  ['QUEUE_BUSY', /wait/i],
  ['NO_GALAXY_BUILD', /not available for this game/i],
  ['GAME_CLIENT_CHANGED', /remove.+add/i],
  ['NETWORK_ERROR', /internet connection/i],
  ['NATIVE_HELPER_MISSING', /reinstall/i],
])('explains %s with a useful next step', (code, guidance) => {
  const error = publicError(cliError(code));
  expect(error.code).toBe(code);
  expect(error.message).toMatch(guidance);
  expect(error.message).not.toMatch(/\bCLI\b|metadata|explicit offset|another command|helper/i);
});

it.each(['bad code https://private.invalid/token', '__proto__', 'constructor', 'A'.repeat(65)])(
  'replaces an invalid error code without showing its contents: %s',
  (code) => {
    const error = publicError(cliError(code));
    expect(error.code).toBe('COMMAND_FAILED');
    expect(error.message).toBe('The request could not be completed. Please try again.');
    expect(error.message).not.toContain(code);
  },
);

it('keeps a new valid error code but gives users a plain fallback', () => {
  expect(publicError(cliError('NEW_SERVER_ERROR'))).toEqual({
    code: 'NEW_SERVER_ERROR',
    message: 'The request could not be completed. Please try again.',
  });
});

it.each(['INVALID_CLI_OUTPUT', 'INVALID_CLI_EXIT', 'CLI_OUTPUT_LIMIT'])(
  'describes %s without assuming this was an unlock attempt',
  (code) => {
    const error = publicError(new DesktopError(code, 'Internal CLI implementation details'));
    expect(error.code).toBe(code);
    expect(error.message).toBe('The app could not complete this action. Please try again.');
    expect(error.message).not.toContain('CLI');
  },
);

it('keeps private exception details out of the public error', () => {
  const error = publicError(new Error('/Users/private/queue.json: secret-token'));
  expect(error).toEqual({
    code: 'LOCAL_ERROR',
    message: 'Something went wrong. Please try again.',
  });
});

it('preserves specific user guidance for other app errors', () => {
  expect(publicError(new DesktopError('STALE_PREVIEW', 'Review your queue again.'))).toEqual({
    code: 'STALE_PREVIEW',
    message: 'Review your queue again.',
  });
});

it('does not read inherited properties as error messages', () => {
  expect(publicError(new DesktopError('constructor', 'Please try again.'))).toEqual({
    code: 'constructor',
    message: 'Please try again.',
  });
});
