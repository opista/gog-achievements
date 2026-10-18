import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { AchievementAction, DesktopApi, Game, ExportInput } from '../shared/api';
import { useApply } from './features/apply/use-apply';
import { useOperation } from './application/use-operation';
import { requiresHistorySessionRecovery, useHistory } from './features/history/use-history';
import { useLibrary } from './features/library/use-library';
import { useQueues } from './features/queue/use-queues';
import { queueGroups } from './features/queue/queue-model';
import { useAccount } from './features/account/use-account';
import { isAccountMismatch } from './features/account/account-errors';
import { toNotice, type Notice } from './presentation/error-notice';
import { holdCliActivation } from './application/cli-activation-guard';

export type View = 'browse' | 'applying' | 'results' | 'history';
export type LoadingTarget =
  'session' | 'library' | 'achievements' | 'queue' | 'history' | 'preview' | 'apply' | 'export';
export function useWorkspace(api: DesktopApi) {
  const working = useRef(false);
  const lifecycle = useRef(0);
  const account = useAccount(api, clearAccountState);
  const { auth, versions } = account;
  const queueState = useQueues(api, account.assertOwner);
  const library = useLibrary(api, {
    assertOwner: account.assertOwner,
    syncQueue: queueState.sync,
  });
  const { games, libraryLoaded, game, achievements, achievementsLoaded } = library;
  const { queues, loaded: queuesLoaded, action: queueAction } = queueState;
  const history = useHistory(api, account.assertOwner);
  const [view, setView] = useState<View>('browse');
  const [loading, setLoading] = useState<string | null>('Checking GOG sign-in…');
  const [loadingTarget, setLoadingTarget] = useState<LoadingTarget>('session');
  const [error, setError] = useState<Notice | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const applyState = useApply(api, {
    assertOwner: account.assertOwner,
    run,
    onView: setView,
    refreshAfterApply,
  });
  const { preview, result, resultGame, previewGameId } = applyState;
  const operations = useOperation(api, {
    canRecover: () => !working.current,
    onRecovered: recoverOperation,
    onCli: account.acceptCli,
  });
  const { operation } = operations;
  const active =
    operation.kind === 'apply' || operation.kind === 'recovery' || operation.kind === 'login';
  const busy = loading !== null || operation.kind !== 'idle';
  const queue = queues.find((item) => item.game.id === game?.id) ?? null;
  function clearGamePresentation() {
    setExportNotice(null);
    applyState.clear();
    setView('browse');
  }
  function clearGameState() {
    library.clearSelection();
    clearGamePresentation();
  }
  function clearAccountState() {
    library.clear();
    queueState.clear();
    history.clear();
    clearGamePresentation();
  }
  async function handleFailure(failure: unknown, isCurrent = () => true) {
    if (!isCurrent()) return;
    await account.recover(failure);
    if (isCurrent()) setError(toNotice(failure));
  }
  async function run(label: string, target: LoadingTarget, task: () => Promise<void>) {
    if (
      working.current ||
      operations.current().kind === 'apply' ||
      operations.current().kind === 'recovery'
    )
      return;
    const stamp = lifecycle.current;
    working.current = true;
    setLoading(label);
    setLoadingTarget(target);
    setError(null);
    let release: (() => void) | undefined;
    try {
      release = await holdCliActivation(api);
      if (stamp !== lifecycle.current) return;
      await task();
    } catch (failure) {
      await handleFailure(failure, () => stamp === lifecycle.current);
    } finally {
      release?.();
      if (stamp === lifecycle.current) {
        working.current = false;
        setLoading(null);
        operations.flushRecovery();
      }
    }
  }
  async function loadGame(next: Game) {
    setLoadingTarget('achievements');
    if (library.currentGame()?.id !== next.id) clearGamePresentation();
    else applyState.invalidate();
    await library.loadGame(next);
  }
  async function loadLibrary(preferredId?: string) {
    setLoadingTarget('library');
    let data;
    try {
      data = await api.listGames();
    } catch (failure) {
      // A failed network library read must not hide readable local drafts.
      if (!isAccountMismatch(failure) && toNotice(failure).code !== 'AUTH_REQUIRED') {
        try {
          await queueState.load();
        } catch (localFailure) {
          if (isAccountMismatch(localFailure)) throw localFailure;
        }
      }
      throw failure;
    }
    if (!(await account.reconcileOwner(data.user_id))) return;
    const first = library.acceptGames(data, preferredId);
    await queueState.load();
    if (!first) clearGameState();
    else if (library.currentGame()?.id !== first.id || !achievementsLoaded) await loadGame(first);
  }
  function recoverOperation(gameId?: string) {
    void run('Checking GOG sign-in…', 'session', async () => {
      setView('browse');
      const initial = await account.refresh();
      if (!initial) return;
      if (initial.auth.authenticated) await loadLibrary(gameId);
    });
  }
  const start = useEffectEvent(async (isMounted: () => boolean) => {
    working.current = true;
    setLoading('Checking GOG sign-in…');
    setLoadingTarget('session');
    const checkpoint = operations.checkpoint();
    let release: (() => void) | undefined;
    try {
      release = await holdCliActivation(api);
      if (!isMounted()) return;
      const initial = await account.bootstrap();
      if (!isMounted() || !initial) return;
      const restored = operations.restore(initial.operation, checkpoint);
      if (restored.kind === 'apply' || restored.kind === 'recovery' || operations.needsRecovery())
        setView('applying');
      else if (initial.auth.authenticated) await loadLibrary();
    } catch (failure) {
      if (isMounted()) await handleFailure(failure, isMounted);
    } finally {
      release?.();
      if (isMounted()) {
        working.current = false;
        setLoading(null);
        operations.flushRecovery();
      }
    }
  });
  useEffect(() => {
    let mounted = true;
    void start(() => mounted);
    return () => {
      mounted = false;
      lifecycle.current += 1;
    };
  }, [api]);
  function login() {
    void run(
      api.isDemo ? 'Connecting demo account…' : 'Complete sign-in in the GOG window.',
      'session',
      async () => {
        const status = await account.login();
        if (status?.authenticated) await loadLibrary();
      },
    );
  }
  function logout() {
    void run('Signing out…', 'session', async () => {
      await account.logout();
    });
  }
  function selectGame(next: Game) {
    void run('Loading achievements…', 'achievements', async () => {
      setView('browse');
      applyState.clear();
      await loadGame(next);
    });
  }
  function refreshQueues() {
    void run('Loading queue…', 'queue', async () => {
      await queueState.load();
    });
  }
  function refreshLibrary() {
    void run('Loading library…', 'library', () => loadLibrary(game?.id));
  }
  function refreshAchievements(currentState = false) {
    if (!library.currentGame()) return;
    void run('Refreshing achievements…', 'achievements', async () => {
      applyState.invalidate();
      await library.refreshSelected(currentState);
      if (currentState) setView('browse');
    });
  }
  async function saveQueue(task: () => Promise<boolean>): Promise<boolean> {
    if (working.current || operations.current().kind !== 'idle') return false;
    applyState.invalidate();
    let succeeded = false;
    await run('Saving queue…', 'queue', async () => {
      succeeded = await task();
    });
    return succeeded;
  }
  function add(ids: string[], action?: AchievementAction) {
    if (!game) return;
    void saveQueue(() =>
      queueState.add({
        gameId: game.id,
        achievementIds: ids,
        ...(action ? { action } : {}),
        game: library.metadataFor(game.id),
        userId: account.current().user_id,
        achievements,
      }),
    );
  }
  function remove(gameId: string, ids: string[]) {
    void saveQueue(() => queueState.remove(gameId, ids));
  }
  function queueAll(ids: string[], action: AchievementAction): Promise<boolean> {
    if (!game || !queuesLoaded || (action === 'lock' && !account.supportsLocking))
      return Promise.resolve(false);
    const addition = {
      gameId: game.id,
      achievementIds: ids,
      action,
      game: library.metadataFor(game.id),
      userId: account.current().user_id,
      achievements,
    };
    return saveQueue(async () => {
      const opposite =
        queueState
          .forGame(addition.gameId)
          ?.items.filter((item) => (item.action ?? 'unlock') !== action)
          .map((item) => item.achievement_id) ?? [];
      if (opposite.length && !(await queueState.remove(addition.gameId, opposite))) return false;
      return ids.length ? queueState.add(addition) : true;
    });
  }
  function clearQueue(gameId?: string): Promise<boolean> {
    if (!queuesLoaded) return Promise.resolve(false);
    const pending = queueGroups(queues)
      .filter((queue) => gameId === undefined || queue.game.id === gameId)
      .map((queue) => ({
        gameId: queue.game.id,
        ids: queue.items.map((item) => item.achievement_id),
      }));
    if (pending.length === 0) return Promise.resolve(false);
    return saveQueue(async () => {
      for (const { gameId, ids } of pending) {
        if (!(await queueState.remove(gameId, ids))) return false;
      }
      return true;
    });
  }
  function saveDates(gameId: string, dates: Record<string, string>): Promise<boolean> {
    return saveQueue(() => queueState.saveDates(gameId, dates));
  }
  async function refreshAfterApply(gameId: string, isCurrent: () => boolean) {
    // Refresh durable local state first; a network failure must not restore stale rows.
    await queueState.sync(gameId);
    if (!isCurrent()) return;
    await library.refreshAfterApply(gameId);
  }
  function showHistory() {
    void run('Loading history…', 'history', async () => {
      setView('history');
      try {
        await history.load();
      } catch (failure) {
        // Ordinary read failures belong to History; account failures still clear
        // the workspace or offer sign-in through the shared recovery path.
        if (requiresHistorySessionRecovery(failure)) throw failure;
      }
    });
  }
  function exportAchievements(filters: Omit<ExportInput, 'gameId'>) {
    if (!game) return;
    const gameId = game.id;
    void run('Exporting achievements…', 'export', async () => {
      setExportNotice(null);
      const result = await api.exportAchievements({ gameId, ...filters });
      if (!result.cancelled)
        setExportNotice(
          `Exported ${result.count} achievement${result.count === 1 ? '' : 's'} to ${result.path}.`,
        );
    });
  }
  function closeApply() {
    if (working.current || operations.current().kind !== 'idle') return;
    applyState.invalidate();
    if (view === 'results') setView('browse');
  }
  function checkResult() {
    if (!resultGame) return;
    const target = games.find((item) => item.id === resultGame.id) ?? resultGame;
    void run('Refreshing achievements…', 'achievements', () => library.loadGame(target, true));
  }
  return {
    supportsLocking: account.supportsLocking,
    supportsExporting: account.supportsExporting,
    exportNotice,
    exportAchievements,
    auth,
    games,
    completion: library.completion,
    libraryLoaded,
    achievementsLoaded,
    queuesLoaded,
    game,
    achievements,
    queues,
    hasAchievementDetails: library.hasAchievements,
    achievementFor: library.achievementFor,
    queue,
    preview,
    result,
    resultGame,
    history: history.records,
    historyLoaded: history.loaded,
    historyLoading: history.loading,
    historyError: history.error,
    view,
    loading,
    loadingTarget,
    queueAction,
    previewGameId,
    error,
    operation,
    versions,
    busy,
    active,
    login,
    logout,
    selectGame,
    refreshLibrary,
    refreshAchievements,
    refreshQueues,
    add,
    queueAll,
    remove,
    clearQueue,
    saveDates,
    prepareApply: (gameId: string) => {
      void applyState.prepare(gameId);
    },
    apply: () => {
      void applyState.apply();
    },
    showHistory,
    closeApply,
    checkResult,
    setView,
    cancelPreview: applyState.invalidate,
    clearError: () => setError(null),
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
