import { useState, type CSSProperties } from 'react';
import { CircleAlert, Gamepad2, History, LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { DesktopApi } from '../shared/api';
import type { DemoDesktopApi, DemoScenario } from '../shared/demo-api';
import { Art } from './components/Art';
import { AccountMenu } from './features/account/AccountMenu';
import { Achievements } from './features/library/Achievements';
import { AchievementSkeleton } from './features/library/AchievementSkeleton';
import { GameCompletion } from './features/library/GameCompletion';
import { ApplyDialog } from './features/apply/ApplyDialog';
import { useLocalTimeZone } from './use-local-time-zone';
import { HistoryView } from './features/history/HistoryView';
import { Library } from './features/library/Library';
import { QueuePane } from './features/queue/QueuePane';
import { useWorkspace, type Workspace } from './use-workspace';

function errorRecovery(w: Workspace): { label: string; run(): void } | null {
  if (!w.auth.authenticated || /AUTH|LOGIN|TOKEN|CREDENTIAL/.test(w.error?.code ?? ''))
    return { label: 'Sign in to GOG', run: w.login };
  switch (w.loadingTarget) {
    case 'library':
      return { label: 'Refresh library', run: w.refreshLibrary };
    case 'achievements':
      return w.game
        ? { label: 'Refresh achievements', run: () => w.refreshAchievements(w.view === 'results') }
        : null;
    case 'queue':
      return { label: 'Reload queue', run: w.refreshQueues };
    case 'history':
      return { label: 'Reload history', run: w.showHistory };
    default:
      return null;
  }
}

export function App({ api }: { api: DesktopApi }) {
  const w = useWorkspace(api);
  const [libraryWidth, setLibraryWidth] = useState<number>();
  const [queueWidth, setQueueWidth] = useState<number>();
  const zone = useLocalTimeZone();
  const [scenario, setScenario] = useState<DemoScenario>(() =>
    'getScenario' in api ? (api as DemoDesktopApi).getScenario() : 'complete',
  );
  const recovery = w.error ? errorRecovery(w) : null;
  const applying =
    w.view === 'applying' || w.operation.kind === 'apply' || w.operation.kind === 'recovery';
  const resultOpen = w.view === 'results' && w.result !== null;
  const modalOpen = Boolean(w.preview || applying || resultOpen);
  const headingGame = w.game;
  const headingTitle = w.game?.title ?? 'Your games';
  return (
    <div className="app-shell">
      <header className="app-header" inert={modalOpen}>
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
            <button className="history-button" disabled={w.busy} onClick={w.showHistory}>
              <History size={17} />
              History
            </button>
          ) : (
            <span className="muted">Not signed in</span>
          )}
          <AccountMenu
            api={api}
            auth={w.auth}
            versions={w.versions}
            busy={w.busy}
            onLogout={w.logout}
          />
        </div>
      </header>
      {w.error ? (
        <div className="error-banner" role="alert">
          <CircleAlert size={19} />
          <span>{w.error.message}</span>
          {recovery ? (
            <button disabled={w.busy} onClick={recovery.run}>
              {recovery.label}
            </button>
          ) : null}
          <button className="icon-button" aria-label="Dismiss error" onClick={w.clearError}>
            <X size={18} />
          </button>
        </div>
      ) : null}
      {w.exportNotice ? (
        <div className="export-notice" role="status">
          {w.exportNotice}
        </div>
      ) : null}
      <main
        inert={modalOpen}
        className={`workspace ${!w.auth.authenticated ? 'signed-out' : ''}`}
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
          loading={w.loading !== null && w.loadingTarget === 'library'}
          demo={api.isDemo}
          onSelect={w.selectGame}
          onRefresh={w.refreshLibrary}
          width={libraryWidth}
          onResize={setLibraryWidth}
        />
        <section className="main-pane" aria-label="Game achievements">
          {!w.auth.authenticated ? (
            <div className="connect-state">
              <span className="connect-mark">
                <Gamepad2 size={54} />
              </span>
              <h2>Get unlocking</h2>
              <button className="primary" disabled={w.busy} onClick={w.login}>
                {w.loading ? (
                  <>
                    <LoaderCircle className="spinner" size={20} />
                    {w.loading}
                  </>
                ) : (
                  'Sign in with GOG'
                )}
              </button>
            </div>
          ) : (
            <>
              {w.view !== 'history' ? (
                <div className="game-heading">
                  {headingGame ? (
                    <Art
                      large
                      image={headingGame.image}
                      name={headingTitle ?? 'Game'}
                      demo={api.isDemo}
                    />
                  ) : null}
                  <div className="game-heading-info">
                    <h2 tabIndex={-1} data-dialog-return-focus>
                      {headingTitle}
                    </h2>
                    {headingGame ? <GameCompletion progress={w.completion} /> : null}
                  </div>
                  {w.game ? (
                    <button
                      className="icon-button desktop-refresh"
                      disabled={w.busy}
                      onClick={() => w.refreshAchievements()}
                      aria-label="Refresh achievements"
                      title="Refresh achievements"
                    >
                      <RefreshCw
                        size={18}
                        className={w.loadingTarget === 'achievements' && w.loading ? 'spinner' : ''}
                      />
                    </button>
                  ) : null}
                </div>
              ) : null}
              {w.view === 'history' ? (
                <>
                  <HistoryView
                    records={w.history}
                    zone={zone}
                    loading={w.loadingTarget === 'history' && w.loading !== null}
                  />
                </>
              ) : w.game && !w.achievementsLoaded ? (
                w.loadingTarget === 'achievements' && w.loading ? (
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
                  queued={
                    new Map(
                      w.queue?.items.map((item) => [
                        item.achievement_id,
                        item.action ?? 'unlock',
                      ]) ?? [],
                    )
                  }
                  busy={w.busy}
                  loading={w.loading !== null && w.loadingTarget === 'achievements'}
                  demo={api.isDemo}
                  zone={zone}
                  supportsLocking={w.supportsLocking}
                  supportsExporting={w.supportsExporting}
                  onExport={w.exportAchievements}
                  onAdd={w.add}
                  onQueueAll={w.queueAll}
                  onRemove={(ids) => {
                    if (w.game) void w.remove(w.game.id, ids);
                  }}
                  onRefresh={() => w.refreshAchievements()}
                />
              ) : (
                <div className="empty-state">
                  <Gamepad2 size={40} />
                  <h3>
                    {w.libraryLoaded && w.games.length === 0
                      ? 'No GOG games found'
                      : 'Choose a game'}
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
          signedIn={w.auth.authenticated}
          queues={w.queues}
          loaded={w.queuesLoaded}
          busy={w.busy}
          action={w.queueAction}
          previewGameId={w.previewGameId}
          applyStatus={
            w.operation.kind === 'recovery' ? 'recovery' : applying ? 'applying' : 'idle'
          }
          achievementFor={w.achievementFor}
          onRefresh={w.refreshQueues}
          onClear={w.clearQueue}
          onRemove={w.remove}
          onSaveDates={w.saveDates}
          onPrepareApply={w.prepareApply}
          zone={zone}
          demo={api.isDemo}
          width={queueWidth}
          onResize={setQueueWidth}
        />
      </main>
      {modalOpen ? (
        <ApplyDialog
          report={w.preview?.report ?? null}
          result={resultOpen ? w.result : null}
          gameTitle={
            w.resultGame?.title ?? w.games.find((game) => game.id === w.operation.gameId)?.title
          }
          applying={applying}
          recovering={w.operation.kind === 'recovery'}
          signedIn={w.auth.authenticated}
          achievementFor={w.achievementFor}
          demo={api.isDemo}
          zone={zone}
          busy={w.busy}
          onClose={w.closeApply}
          onApply={w.apply}
          onHistory={() => {
            w.closeApply();
            w.showHistory();
          }}
          onCheckCurrentState={w.checkResult}
          refreshError={resultOpen ? w.error?.message : undefined}
        />
      ) : null}
    </div>
  );
}
