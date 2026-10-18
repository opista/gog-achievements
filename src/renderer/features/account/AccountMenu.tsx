import { useEffect, useId, useRef, useState } from 'react';
import { Download, LoaderCircle, LogOut, UserRound } from 'lucide-react';
import type { AuthStatus, DesktopApi } from '../../../shared/api';
import type { CliUpdateState } from '../../../shared/cli-updates';

interface AccountMenuProps {
  api: Pick<
    DesktopApi,
    'checkForUpdates' | 'getCliUpdateState' | 'setAutomaticCliUpdates' | 'useBundledCli'
  >;
  auth: AuthStatus;
  versions: { app: string; cli: string };
  busy: boolean;
  onLogout: () => void;
}

export function AccountMenu({ api, auth, versions, busy, onLogout }: AccountMenuProps) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updates, setUpdates] = useState<CliUpdateState>();
  const generation = useRef(0);
  const savingRef = useRef(false);
  const updateHelp = useId();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const stamp = generation.current;
      try {
        if (!savingRef.current) {
          const state = await api.getCliUpdateState();
          if (!cancelled && stamp === generation.current) setUpdates(state);
        }
      } catch {
        if (!cancelled)
          setError('Update settings could not be loaded. Close the menu and try again.');
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

  async function changeUpdates(action: () => Promise<CliUpdateState>) {
    if (savingRef.current) return;
    savingRef.current = true;
    generation.current++;
    setSaving(true);
    setError(undefined);
    try {
      setUpdates(await action());
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Update settings could not be saved. Try again.',
      );
    } finally {
      generation.current++;
      savingRef.current = false;
      setSaving(false);
    }
  }

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
        <div className="account-update-settings">
          <label className="account-update-toggle">
            <input
              type="checkbox"
              checked={updates?.automatic ?? false}
              disabled={busy || saving || checking || !updates?.supported}
              aria-describedby={updateHelp}
              onChange={(event) =>
                void changeUpdates(() =>
                  api.setAutomaticCliUpdates({ enabled: event.target.checked }),
                )
              }
            />
            Automatic component updates
          </label>
          <small id={updateHelp}>
            The app automatically updates the tools it uses to connect to GOG.
          </small>
          {updates ? (
            <p className="account-update-notice" role="status">
              {updates.message}
            </p>
          ) : null}
          {updates?.supported && updates.currentVersion !== updates.bundledVersion ? (
            <button
              disabled={
                busy || saving || checking || updates.pendingVersion === updates.bundledVersion
              }
              onClick={() => void changeUpdates(() => api.useBundledCli())}
            >
              Use bundled version next launch
            </button>
          ) : null}
        </div>
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
          <small>CLI {updates?.currentVersion ?? versions.cli}</small>
        ) : null}
      </div>
    </details>
  );
}
