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
  AUTH_REJECTED: 'Please sign in to GOG again.',
  AUTH_CANCELLED: 'Sign-in was cancelled.',
  AUTH_TIMEOUT: 'Sign-in timed out. Try again.',
  WEBVIEW2_MISSING: 'Install Microsoft Edge WebView2 to open GOG sign-in, then try again.',
  KEYCHAIN_UNAVAILABLE: 'Unlock your Mac Keychain, then sign in again. Allow access when asked.',
  KEYCHAIN_STORE_FAILED: 'The login could not be saved. Sign in again and allow Keychain access.',
  CREDENTIAL_STORE_UNAVAILABLE:
    'Windows could not access your saved sign-in. Restart the app and sign in again.',
  CREDENTIAL_STORE_FAILED: 'Windows could not save your sign-in. Please sign in again.',
  INVALID_CREDENTIALS: 'The saved login is invalid. Sign in again.',
  NATIVE_HELPER_MISSING: 'The sign-in window is missing. Reinstall the app.',
  NATIVE_HELPER_FAILED: 'The GOG sign-in window could not open. Try again or reinstall the app.',
  LOGIN_PAGE_FAILED: 'The GOG sign-in page could not load. Check your connection and try again.',
  NETWORK_ERROR: 'Could not connect to GOG. Check your internet connection and try again.',
  API_REJECTED: 'GOG could not complete the request. Please try again.',
  ACCOUNT_MISMATCH: 'This queue belongs to another GOG account.',
  GAME_NOT_OWNED: 'This account does not own the game.',
  GAME_CLIENT_CHANGED:
    "This game's achievement list changed. Remove its queued achievements and add them again.",
  ACHIEVEMENT_CHANGED: 'An achievement changed. Refresh achievements and review your queue.',
  ALREADY_UNLOCKED: 'This achievement is already unlocked. Its date will be kept.',
  ALREADY_LOCKED:
    'This achievement is already locked. Refresh achievements before queuing it again.',
  UNLOCK_DATE_CHANGED: 'The unlock date changed. Remove the queued lock and add it again.',
  INVALID_DATE_EDIT: 'Only queued unlocks can have their dates edited.',
  CLI_UPDATE_REQUIRED: 'Locking achievements needs a newer CLI. Update the app to continue.',
  CSV_EXPORT_UNSUPPORTED: 'CSV export needs a newer CLI. Check for updates in the account menu.',
  EXPORT_EXISTS: 'The export file already exists. Choose another file name.',
  EXPORT_WRITE_FAILED: 'Could not save the CSV. Check the folder and file permissions.',
  DUPLICATE_ACHIEVEMENT: 'This achievement is already queued.',
  ACHIEVEMENT_NOT_FOUND: 'This game does not have the selected achievement.',
  ACHIEVEMENT_NOT_QUEUED: 'A selected achievement is not in the queue.',
  EMPTY_QUEUE: 'Add an achievement to the queue first.',
  FUTURE_DATE: 'The unlock time cannot be in the future.',
  INVALID_DATE: 'Choose a valid date and time.',
  QUEUE_BUSY: 'This queue is being updated. Please wait and try again.',
  NO_GALAXY_BUILD: 'Achievements are not available for this game.',
  APPLY_INCOMPLETE: 'Results need attention. Check each achievement before another attempt.',
  INVALID_RESPONSE: 'Could not read the response from GOG. Please try again.',
  INCOMPLETE_RESPONSE: 'Could not load the full list. Refresh it and try again.',
  CLI_PACKAGE_INVALID: 'Some app files are missing or damaged. Reinstall the app.',
  CLI_VERSION_MISMATCH: 'Some app files do not match. Reinstall the app.',
  CLI_START_FAILED: 'The app could not start this action. Restart the app and try again.',
  CLI_READ_TIMEOUT: 'The read took too long and was stopped. Please try again.',
  CLI_READ_CANCELLED: 'The read was cancelled.',
  INVALID_CLI_OUTPUT: 'The app could not complete this action. Please try again.',
  INVALID_CLI_EXIT: 'The app could not complete this action. Please try again.',
  CLI_OUTPUT_LIMIT: 'The app could not complete this action. Please try again.',
};
export function cliError(code: string): DesktopError {
  const publicCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'COMMAND_FAILED';
  return new DesktopError(
    publicCode,
    messages[publicCode] ?? 'The request could not be completed. Please try again.',
  );
}
export function publicError(error: unknown): PublicError {
  return error instanceof DesktopError
    ? {
        code: error.code,
        message:
          (Object.hasOwn(messages, error.code) ? messages[error.code] : undefined) ?? error.message,
      }
    : {
        code: 'LOCAL_ERROR',
        message: 'Something went wrong. Please try again.',
      };
}
