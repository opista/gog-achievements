import { useState } from 'react';
import { Download, LoaderCircle, LogOut, UserRound } from 'lucide-react';
import type { AuthStatus, DesktopApi } from '../../shared/api';

interface AccountMenuProps {
  api: Pick<DesktopApi, 'checkForUpdates'>;
  auth: AuthStatus;
  versions: { app: string; cli: string };
  busy: boolean;
  onLogout: () => void;
}

export function AccountMenu({ api, auth, versions, busy, onLogout }: AccountMenuProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();

  async function checkForUpdates() {
    if (checking) return;
    setChecking(true);
    setError(undefined);
    try {
      await api.checkForUpdates();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Updates could not be checked. Try again.',
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <details className="account-menu">
      <summary aria-label="Account menu" title="Account">
        <UserRound size={18} aria-hidden="true" />
        <span className="caret" />
      </summary>
      <div className="account-popover">
        {auth.authenticated ? <small>Account ID: {auth.user_id}</small> : null}
        <button disabled={busy || checking} aria-busy={checking} onClick={checkForUpdates}>
          {checking ? (
            <LoaderCircle size={17} className="spinner" aria-hidden="true" />
          ) : (
            <Download size={17} aria-hidden="true" />
          )}
          {checking ? 'Checking…' : 'Check for updates…'}
        </button>
        {error ? (
          <p className="account-update-notice" role="alert">
            {error}
          </p>
        ) : null}
        {auth.authenticated ? (
          <button disabled={busy} onClick={onLogout}>
            <LogOut size={17} aria-hidden="true" />
            Sign out
          </button>
        ) : null}
        {versions.app ? (
          <small>
            App {versions.app}
            <br />
            CLI {versions.cli}
          </small>
        ) : null}
      </div>
    </details>
  );
}
