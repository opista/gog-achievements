import { useEffect, useRef, useState } from 'react';
import { Download, LoaderCircle, LogOut, UserRound } from 'lucide-react';
import type { AuthStatus, DesktopApi } from '../../../shared/api';
import type { CliUpdateState } from '../../../shared/cli-updates';

interface AccountMenuProps {
  api: Pick<DesktopApi, 'checkForUpdates' | 'getCliUpdateState'>;
  auth: AuthStatus;
  versions: { app: string; cli: string };
  busy: boolean;
  onLogout: () => void;
}

export function AccountMenu({ api, auth, versions, busy, onLogout }: AccountMenuProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [updates, setUpdates] = useState<CliUpdateState>();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const state = await api.getCliUpdateState();
        if (!cancelled) setUpdates(state);
      } catch {
        if (!cancelled)
          setError('CLI update status could not be loaded. Close the menu and try again.');
      } finally {
        if (!cancelled) timer = setTimeout(() => void refresh(), 2000);
      }
    }
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, open]);

  useEffect(() => {
    function dismissOutside(event: PointerEvent | FocusEvent) {
      const menu = menuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target))
        menu.open = false;
    }
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, []);

  function closeMenu() {
    if (menuRef.current) menuRef.current.open = false;
    summaryRef.current?.focus();
  }

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

  const updating = updates?.status === 'checking' || updates?.status === 'downloading';

  return (
    <details
      ref={menuRef}
      className="account-menu"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menuRef.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
        }
      }}
    >
      <summary ref={summaryRef} aria-label="Account menu" title="Account">
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
          <button
            disabled={busy}
            onClick={() => {
              closeMenu();
              onLogout();
            }}
          >
            <LogOut size={17} aria-hidden="true" />
            Sign out
          </button>
        ) : null}
        {versions.app ? <small>App {versions.app}</small> : null}
        {updates?.currentVersion || versions.cli ? (
          <div className="account-cli-version">
            <small>CLI {updates?.currentVersion ?? versions.cli}</small>
            {updating ? (
              <span className="account-cli-progress" role="status" title={updates.message}>
                <LoaderCircle size={14} className="spinner" aria-hidden="true" />
                <span className="sr-only">{updates.message}</span>
              </span>
            ) : null}
            {updates?.status === 'ready' ? (
              <small role="status">{updates.pendingVersion} ready · next launch</small>
            ) : null}
          </div>
        ) : null}
        {updates?.status === 'fallback' || updates?.status === 'unavailable' ? (
          <p className="account-update-notice" role="status">
            {updates.message}
          </p>
        ) : null}
      </div>
    </details>
  );
}
