import { toNotice } from '../../presentation/error-notice';

export class AccountChangedError extends Error {
  readonly code = 'ACCOUNT_CHANGED';

  constructor() {
    super('The GOG account changed. Refresh the library to load matching account data.');
  }
}

export function isAccountMismatch(failure: unknown): boolean {
  return ['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH'].includes(toNotice(failure).code ?? '');
}
