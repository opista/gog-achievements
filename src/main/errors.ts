import type { PublicError } from '../shared/api';

export class DesktopError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DesktopError';
  }
}
const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Sign in to GOG to continue.',
  AUTH_REJECTED: 'GOG rejected the saved login. Sign in again.',
  AUTH_CANCELLED: 'Sign-in was cancelled.',
  AUTH_TIMEOUT: 'Sign-in timed out. Try again.',
  WEBVIEW2_MISSING: 'GOG sign-in needs the Microsoft Edge WebView2 Runtime.',
  KEYCHAIN_UNAVAILABLE:
    'Unlock the Mac Keychain, then sign in and allow the GOG helper access when asked.',
  KEYCHAIN_STORE_FAILED: 'The login could not be saved. Sign in again and allow Keychain access.',
  CREDENTIAL_STORE_UNAVAILABLE:
    'The Windows protected login store is unavailable. Use your Windows user account.',
  CREDENTIAL_STORE_FAILED:
    'The login could not be saved in the Windows protected store. Sign in again.',
  INVALID_CREDENTIALS: 'The saved login is invalid. Sign in again.',
  NATIVE_HELPER_MISSING: 'The bundled sign-in helper is missing. Reinstall the app.',
  NATIVE_HELPER_FAILED:
    'The GOG sign-in window could not start. Reinstall the app or retry sign-in.',
  LOGIN_PAGE_FAILED: 'The GOG sign-in page could not load. Check your connection and try again.',
  NETWORK_ERROR: 'The request failed or timed out.',
  API_REJECTED: 'GOG rejected the request.',
  ACCOUNT_MISMATCH: 'This queue belongs to another GOG account.',
  GAME_NOT_OWNED: 'This account does not own the game.',
  GAME_CLIENT_CHANGED: 'The game metadata changed. Create a new queue.',
  ACHIEVEMENT_CHANGED: 'An achievement changed. Review the queue again.',
  ALREADY_UNLOCKED: 'This achievement is already unlocked. Its date will be kept.',
  DUPLICATE_ACHIEVEMENT: 'This achievement is already queued.',
  ACHIEVEMENT_NOT_FOUND: 'This game does not have the selected achievement.',
  ACHIEVEMENT_NOT_QUEUED: 'A selected achievement is not in the queue.',
  EMPTY_QUEUE: 'Add an achievement to the queue first.',
  FUTURE_DATE: 'The unlock time cannot be in the future.',
  INVALID_DATE: 'Enter a valid date and time with an explicit offset.',
  QUEUE_BUSY: 'This queue is in use by another command.',
  NO_GALAXY_BUILD: 'No published Galaxy achievement metadata is available for this game.',
  APPLY_INCOMPLETE: 'Results need attention. Check each achievement before another attempt.',
  INVALID_RESPONSE: 'GOG returned an invalid response.',
  INCOMPLETE_RESPONSE: 'GOG returned an incomplete list. Refresh it.',
};
export function cliError(code: string): DesktopError {
  return new DesktopError(
    /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'COMMAND_FAILED',
    messages[code] ?? 'The CLI command could not complete. Check sign-in and try again.',
  );
}
export function publicError(error: unknown): PublicError {
  return error instanceof DesktopError
    ? { code: error.code, message: error.message }
    : {
        code: 'LOCAL_ERROR',
        message: 'The local operation could not complete. No result was confirmed.',
      };
}
