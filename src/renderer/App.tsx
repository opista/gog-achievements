import { useState, type CSSProperties } from 'react';
import {
  CircleAlert,
  Gamepad2,
  History,
  LoaderCircle,
  LogOut,
  RefreshCw,
  UserRound,
  X,
} from 'lucide-react';
import type { DesktopApi } from '../shared/api';
import type { DemoDesktopApi, DemoScenario } from '../shared/demo-api';
import { Art } from './components/Art';
import { Achievements } from './features/Achievements';
import { AchievementSkeleton } from './features/AchievementSkeleton';
import { ApplyConfirmation, PreviewRows } from './features/Review';
import { DateEditor } from './features/DateEditor';
import { HistoryView, Results } from './features/Results';
import { Library } from './features/Library';
import { QueuePane } from './features/QueuePane';
import { useWorkspace } from './use-workspace';

export function App({ api }: { api: DesktopApi }) {
  const w = useWorkspace(api);
  const [libraryWidth, setLibraryWidth] = useState<number>();
  const [queueWidth, setQueueWidth] = useState<number>();
  const [zone, setZone] = useState(() =>
    api.isDemo ? 'Europe/London' : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [selection, setSelection] = useState<{ gameId: string; ids: Set<string> } | null>(null);
  const [dateEdit, setDateEdit] = useState<{ gameId: string; ids: string[] } | null>(null);
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const [scenario, setScenario] = useState<DemoScenario>(() =>
    'getScenario' in api ? (api as DemoDesktopApi).getScenario() : 'complete',
  );
  const queueSelected =
    selection && selection.gameId === w.game?.id
      ? selection.ids
      : new Set(w.queue?.items.map((item) => item.achievement_id) ?? []);
  const dateIds = dateEdit?.gameId === w.game?.id ? dateEdit?.ids : null;
  const confirm = confirmationToken !== null && confirmationToken === w.preview?.token;
  function setDateIds(ids: string[] | null) {
    setDateEdit(ids && w.game ? { gameId: w.game.id, ids } : null);
  }
  function setConfirm(value: boolean) {
    setConfirmationToken(value ? (w.preview?.token ?? null) : null);
  }
  const editingItems =
    w.queue?.items.filter(
      (item) =>
        dateIds?.includes(item.achievement_id) &&
        !w.achievements.find((achievement) => achievement.id === item.achievement_id)?.unlocked,
    ) ?? [];
  function toggleQueue(id: string) {
    const next = new Set(queueSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelection({ gameId: w.game?.id ?? '', ids: next });
  }
  const needsLogin = !w.auth.authenticated || /AUTH|LOGIN|TOKEN/.test(w.error?.code ?? '');
  const applying =
    w.view === 'applying' || w.operation.kind === 'apply' || w.operation.kind === 'recovery';
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-mark">
            <img src="./assets/app-icon.png" alt="" />
          </span>
          <h1>GOG Achievements</h1>
        </div>
        {api.isDemo ? (
          <div className="demo-tools">
            <span className="demo-badge" title="Simulated account, data and writes. No GOG access.">
              DEMO DATA
            </span>
            {'setScenario' in api ? (
              <label className="sr-label">
                Demo scenario
                <select
                  aria-label="Demo scenario"
                  disabled={w.busy}
                  value={scenario}
                  onChange={(event) => {
                    const next = event.target.value as DemoScenario;
                    (api as DemoDesktopApi).setScenario(next);
                    setScenario(next);
                    w.setView('browse');
                    if (w.auth.authenticated) w.refreshLibrary();
                  }}
                >
                  <option value="complete">Complete results</option>
                  <option value="partial">Partial results</option>
                  <option value="unknown">Unknown outcome</option>
                  <option value="empty">Empty library</option>
                  <option value="error">Read error</option>
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="account-controls">
          {w.auth.authenticated ? (
            <>
              <button
                className="history-button"
                disabled={w.busy || !w.game}
                onClick={() => w.setView('history')}
              >
                <History size={17} />
                History
              </button>
              <details className="account-menu">
                <summary>
                  <UserRound size={18} />
                  GOG account
                  <span className="caret" />
                </summary>
                <div className="account-popover">
                  <small>Account ID: {w.auth.user_id}</small>
                  <button disabled={w.busy} onClick={w.logout}>
                    <LogOut size={17} />
                    Sign out
                  </button>
                  <small>
                    App {w.versions.app}
                    <br />
                    CLI {w.versions.cli}
                  </small>
                </div>
              </details>
            </>
          ) : (
            <span className="muted">Not signed in</span>
          )}
        </div>
      </header>
      {w.error ? (
        <div className="error-banner" role="alert">
          <CircleAlert size={19} />
          <span>
            {w.error.message}
            {w.auth.authenticated ? ' Data may not be refreshed.' : ''}
          </span>
          <button disabled={w.busy} onClick={needsLogin ? w.login : w.refreshLibrary}>
            {needsLogin ? 'Sign in to GOG' : 'Retry'}
          </button>
          <button className="icon-button" aria-label="Dismiss error" onClick={w.clearError}>
            <X size={18} />
          </button>
        </div>
      ) : null}
      <main
        className="workspace"
        style={
          {
            '--library-width': libraryWidth ? `${libraryWidth}px` : undefined,
            '--queue-width': queueWidth ? `${queueWidth}px` : undefined,
          } as CSSProperties
        }
      >
        <Library
          games={w.games}
          gameId={w.game?.id}
          signedIn={w.auth.authenticated}
          loaded={w.libraryLoaded}
          busy={w.busy}
          demo={api.isDemo}
          onSelect={w.selectGame}
          onRefresh={w.refreshLibrary}
          width={libraryWidth}
          onResize={setLibraryWidth}
        />
        <section className="main-pane" aria-label="Game achievements">
          {!w.auth.authenticated && applying ? (
            <div className="active-state" role="status">
              <LoaderCircle size={42} className="spinner" />
              <h2>Checking an interrupted operation…</h2>
              <p>A previous writer is still active. Keep the app open until it exits.</p>
              <p className="muted">No new operation will be started.</p>
            </div>
          ) : !w.auth.authenticated ? (
            <div className="connect-state">
              <span className="connect-mark">
                <Gamepad2 size={54} />
              </span>
              <h2>Connect GOG</h2>
              <p>Sign in to load your games and achievements.</p>
              <button className="primary" disabled={w.busy} onClick={w.login}>
                {w.loading ? (
                  <>
                    <LoaderCircle className="spinner" size={20} />
                    {w.loading}
                  </>
                ) : (
                  'Sign in to GOG'
                )}
              </button>
              <p className="muted">
                {api.isDemo
                  ? 'Demo sign-in uses sample data only.'
                  : 'Sign-in opens in a GOG window.'}
              </p>
            </div>
          ) : (
            <>
              <div className="game-heading">
                {w.game ? (
                  <Art large image={w.game.image} name={w.game.title} demo={api.isDemo} />
                ) : null}
                <div>
                  <h2>{w.game?.title ?? 'Your games'}</h2>
                  {w.view === 'preview' ? <h3 className="muted">Review changes</h3> : null}
                </div>
                {w.game && w.view === 'browse' ? (
                  <button
                    className="desktop-refresh"
                    disabled={w.busy}
                    onClick={() => w.refreshAchievements()}
                  >
                    <RefreshCw size={19} />
                    Refresh
                  </button>
                ) : null}
              </div>
              {w.loading &&
              !applying &&
              (w.view !== 'browse' || (w.libraryLoaded && w.achievementsLoaded)) ? (
                <p className="loading-line" role="status">
                  <LoaderCircle size={18} className="spinner" />
                  {w.loading}
                </p>
              ) : null}
              {applying ? (
                <div className="active-state" role="status">
                  <LoaderCircle size={42} className="spinner" />
                  <h2>Applying changes…</h2>
                  <p>Keep the app open until the result is available.</p>
                  <p className="muted">The operation cannot be cancelled.</p>
                </div>
              ) : w.view === 'preview' && w.preview ? (
                <>
                  <p className="preview-intro">
                    Review the requested dates before applying. GOG account{' '}
                    {w.preview.report.user_id}.
                  </p>
                  <PreviewRows report={w.preview.report} zone={zone} />
                </>
              ) : w.view === 'results' && w.result ? (
                <Results result={w.result} zone={zone} />
              ) : w.view === 'history' ? (
                <HistoryView records={w.history} zone={zone} onView={w.viewRecord} />
              ) : w.game && !w.achievementsLoaded ? (
                w.busy ? (
                  <AchievementSkeleton />
                ) : (
                  <div className="empty-state" role="status">
                    <p>Game data could not be loaded.</p>
                    <button onClick={() => w.game && w.selectGame(w.game)}>Retry game data</button>
                  </div>
                )
              ) : w.game ? (
                <Achievements
                  key={w.game.id}
                  achievements={w.achievements}
                  queued={new Set(w.queue?.items.map((item) => item.achievement_id) ?? [])}
                  busy={w.busy}
                  demo={api.isDemo}
                  zone={zone}
                  onAdd={w.add}
                  onRefresh={() => w.refreshAchievements()}
                />
              ) : (
                <div className="empty-state">
                  <Gamepad2 size={40} />
                  <h3>
                    {w.busy
                      ? 'Loading your library…'
                      : w.libraryLoaded
                        ? 'No GOG games found'
                        : 'Library could not be loaded.'}
                  </h3>
                  {!w.busy ? (
                    <button onClick={w.refreshLibrary}>
                      {w.libraryLoaded ? 'Refresh library' : 'Retry library'}
                    </button>
                  ) : null}
                </div>
              )}
            </>
          )}
        </section>
        <QueuePane
          workspace={w}
          zone={zone}
          demo={api.isDemo}
          selected={queueSelected}
          onToggle={toggleQueue}
          onDate={setDateIds}
          onZone={setZone}
          onConfirm={() => setConfirm(true)}
          width={queueWidth}
          onResize={setQueueWidth}
        />
      </main>
      {dateIds && editingItems.length > 0 ? (
        <DateEditor
          items={editingItems}
          zone={zone}
          busy={w.busy}
          onClose={() => setDateIds(null)}
          onSave={w.saveDates}
          onZone={setZone}
        />
      ) : null}
      {confirm && w.preview ? (
        <ApplyConfirmation
          report={w.preview.report}
          zone={zone}
          busy={w.busy}
          onClose={() => setConfirm(false)}
          onApply={() => {
            setConfirm(false);
            w.apply();
          }}
        />
      ) : null}
    </div>
  );
}
