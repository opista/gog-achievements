import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type {
  ApplyResult,
  DesktopApi,
  Game,
  OperationState,
  PreviewResult,
  Queue,
  QueueGame,
} from '../shared/api';
import { useHistory } from './features/history/use-history';
import { useLibrary } from './features/library/use-library';
import { useAccount } from './features/account/use-account';
import { isAccountMismatch } from './features/account/account-errors';
import { toNotice, type Notice } from './presentation/error-notice';

export type View = 'browse' | 'applying' | 'results' | 'history';
export type LoadingTarget =
  'session' | 'library' | 'achievements' | 'queue' | 'history' | 'preview' | 'apply';
export function useWorkspace(api: DesktopApi) {
  const account = useAccount(api, clearAccountState);
  const { auth, versions } = account;
  const library = useLibrary(api, {
    assertOwner: account.assertOwner,
    syncQueue: syncSelectedQueue,
  });
  const { games, libraryLoaded, game, achievements, achievementsLoaded } = library;
  const [queuesLoaded, setQueuesLoaded] = useState(false);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [queueDetailsLoading, setQueueDetailsLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [resultGame, setResultGame] = useState<QueueGame | null>(null);
  const history = useHistory(api, account.assertOwner);
  const [view, setView] = useState<View>('browse');
  const [loading, setLoading] = useState<string | null>('Checking GOG sign-in…');
  const [loadingTarget, setLoadingTarget] = useState<LoadingTarget>('session');
  const [queueAction, setQueueAction] = useState<{
    kind: 'add' | 'remove' | 'date';
    gameId: string;
  } | null>(null);
  const [previewGameId, setPreviewGameId] = useState<string | null>(null);
  const [error, setError] = useState<Notice | null>(null);
  const [operation, setOperation] = useState<OperationState>({ kind: 'idle' });
  const working = useRef(false);
  const latestOperation = useRef(operation);
  latestOperation.current = operation;
  const active =
    operation.kind === 'apply' || operation.kind === 'recovery' || operation.kind === 'login';
  const busy = loading !== null || operation.kind !== 'idle';
  const queue = queues.find((item) => item.game.id === game?.id) ?? null;
  function invalidate() {
    setPreview(null);
  }
  function clearGamePresentation() {
    setResult(null);
    setResultGame(null);
    setView('browse');
    invalidate();
  }
  function clearGameState() {
    library.clearSelection();
    clearGamePresentation();
  }
  function clearAccountState() {
    library.clear();
    setQueues([]);
    setQueuesLoaded(false);
    history.clear();
    clearGamePresentation();
  }
  async function handleFailure(failure: unknown) {
    await account.recover(failure);
    setError(toNotice(failure));
  }
  async function run(label: string, target: LoadingTarget, task: () => Promise<void>) {
    if (
      working.current ||
      latestOperation.current.kind === 'apply' ||
      latestOperation.current.kind === 'recovery'
    )
      return;
    working.current = true;
    setLoading(label);
    setLoadingTarget(target);
    setError(null);
    try {
      await task();
    } catch (failure) {
      await handleFailure(failure);
    } finally {
      working.current = false;
      setLoading(null);
    }
  }
  function updateQueue(gameId: string, value: Queue | null) {
    if (value) account.assertOwner(value.user_id);
    setQueues((previous) => [
      ...previous.filter((item) => item.game.id !== gameId),
      ...(value ? [value] : []),
    ]);
  }
  async function syncSelectedQueue(gameId: string, isCurrent: () => boolean) {
    const value = await api.getQueue(gameId);
    if (isCurrent()) updateQueue(gameId, value);
  }
  async function loadQueues() {
    const values = await api.listQueues();
    for (const value of values) account.assertOwner(value.user_id);
    setQueues(values);
    setQueuesLoaded(true);
    return values;
  }
  async function loadQueueDetails(values: Queue[]) {
    const missing = values.filter(
      (value) =>
        value.items.length &&
        value.game.id !== library.currentGame()?.id &&
        !library.hasAchievements(value.game.id),
    );
    if (!missing.length) return;
    setLoadingTarget('queue');
    setQueueDetailsLoading(true);
    try {
      for (const value of missing) {
        try {
          await library.loadDetails(value.game.id);
        } catch (failure) {
          if (isAccountMismatch(failure)) throw failure;
          // Saved requests stay usable when optional descriptions cannot be read.
        }
      }
    } finally {
      setQueueDetailsLoading(false);
    }
  }
  async function loadGame(next: Game) {
    setLoadingTarget('achievements');
    if (library.currentGame()?.id !== next.id) clearGamePresentation();
    else invalidate();
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
          await loadQueues();
          await history.load();
        } catch (localFailure) {
          if (isAccountMismatch(localFailure)) throw localFailure;
        }
      }
      throw failure;
    }
    if (!(await account.reconcileOwner(data.user_id))) return;
    const first = library.acceptGames(data, preferredId);
    const savedQueues = await loadQueues();
    await history.load();
    if (!first) clearGameState();
    else if (library.currentGame()?.id !== first.id || !achievementsLoaded) await loadGame(first);
    await loadQueueDetails(savedQueues);
  }
  const handleOperation = useEffectEvent((state: OperationState) => {
    const previous = latestOperation.current;
    latestOperation.current = state;
    setOperation(state);
    if (previous.kind === 'recovery' && state.kind === 'idle')
      void run('Checking GOG sign-in…', 'session', async () => {
        const initial = await account.refresh();
        if (!initial) return;
        if (initial.auth.authenticated) await loadLibrary(previous.gameId);
        else setView('browse');
      });
  });
  const start = useEffectEvent(async (isMounted: () => boolean) => {
    working.current = true;
    setLoading('Checking GOG sign-in…');
    setLoadingTarget('session');
    try {
      const initial = await account.bootstrap();
      if (!isMounted() || !initial) return;
      setOperation(initial.operation);
      latestOperation.current = initial.operation;
      if (initial.operation.kind === 'apply' || initial.operation.kind === 'recovery')
        setView('applying');
      else if (initial.auth.authenticated) await loadLibrary();
    } catch (failure) {
      if (isMounted()) await handleFailure(failure);
    } finally {
      if (isMounted()) {
        working.current = false;
        setLoading(null);
      }
    }
  });
  useEffect(() => {
    let mounted = true;
    const unsubscribe = api.onOperation((state) => {
      if (mounted) handleOperation(state);
    });
    void start(() => mounted);
    return () => {
      mounted = false;
      unsubscribe();
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
      setResult(null);
      setResultGame(null);
      await loadGame(next);
    });
  }
  function refreshQueues() {
    void run('Loading queue…', 'queue', async () => {
      const values = await loadQueues();
      await loadQueueDetails(values);
    });
  }
  function refreshLibrary() {
    void run('Loading library…', 'library', () => loadLibrary(game?.id));
  }
  function refreshAchievements(currentState = false) {
    if (!library.currentGame()) return;
    void run('Refreshing achievements…', 'achievements', async () => {
      invalidate();
      await library.refreshSelected(currentState);
      if (currentState) setView('browse');
    });
  }
  async function mutate(
    gameId: string,
    kind: 'add' | 'remove' | 'date',
    task: () => Promise<Queue>,
    optimistic?: Queue,
  ): Promise<boolean> {
    if (working.current || latestOperation.current.kind !== 'idle') return false;
    invalidate();
    let succeeded = false;
    await run('Saving queue…', 'queue', async () => {
      setQueueAction({ kind, gameId });
      if (optimistic) updateQueue(gameId, optimistic);
      try {
        const value = await task();
        updateQueue(gameId, value);
        succeeded = true;
      } catch (failure) {
        if (!isAccountMismatch(failure)) {
          try {
            await loadQueues();
          } catch {
            // Roll back provisional rows if both save and reload fail.
            if (optimistic)
              updateQueue(gameId, queues.find((item) => item.game.id === gameId) ?? null);
          }
        }
        throw failure;
      } finally {
        setQueueAction(null);
      }
    });
    return succeeded;
  }
  function add(ids: string[]) {
    if (!game) return;
    const metadata = library.metadataFor(game.id);
    const timestamp = new Date().toISOString();
    const userId = account.current().user_id;
    const provisional: Queue | undefined =
      metadata && userId
        ? {
            schema_version: 1,
            user_id: userId,
            game: metadata,
            created_at: queue?.created_at ?? timestamp,
            updated_at: timestamp,
            items: [
              ...(queue?.items ?? []),
              ...achievements
                .filter(
                  (item) =>
                    ids.includes(item.id) &&
                    !item.unlocked &&
                    !queue?.items.some((saved) => saved.achievement_id === item.id),
                )
                .map((item) => ({
                  achievement_id: item.id,
                  key: item.key,
                  name: item.name,
                  unlocked_at: timestamp,
                })),
            ],
          }
        : undefined;
    void mutate(
      game.id,
      'add',
      () => api.addAchievements({ gameId: game.id, achievementIds: ids }),
      provisional,
    );
  }
  function remove(gameId: string, ids: string[]) {
    void mutate(gameId, 'remove', () => api.removeAchievements({ gameId, achievementIds: ids }));
  }
  function saveDates(gameId: string, dates: Record<string, string>): Promise<boolean> {
    return mutate(gameId, 'date', () => api.setDates({ gameId, dates }));
  }
  function prepareApply(gameId: string) {
    if (working.current) return;
    setPreviewGameId(gameId);
    void run('Checking changes…', 'preview', async () => {
      try {
        const value = await api.preview({ gameId });
        account.assertOwner(value.report.user_id);
        setPreview(value);
      } finally {
        setPreviewGameId(null);
      }
    });
  }
  function apply() {
    if (!preview || working.current) return;
    const { token, report } = preview;
    setView('applying');
    setPreview(null);
    setResultGame(report.game);
    void run('Applying changes…', 'apply', async () => {
      try {
        const value = await api.apply({ previewToken: token });
        if (value.report) account.assertOwner(value.report.user_id);
        setResult(value);
      } catch (failure) {
        if (isAccountMismatch(failure)) throw failure;
        setResult({
          operationId: '',
          state: 'unknown',
          report: null,
          error: {
            code: toNotice(failure).code ?? 'UNKNOWN_OUTCOME',
            message: toNotice(failure).message,
          },
        });
      }
      setView('results');
      try {
        // Refresh durable local state first; a later network failure must not restore stale rows.
        updateQueue(report.game.id, await api.getQueue(report.game.id));
        await history.load();
        await library.refreshAfterApply(report.game.id);
      } catch (failure) {
        await handleFailure(failure);
      }
    });
  }
  function showHistory() {
    void run('Loading history…', 'history', async () => {
      setView('history');
      await history.load();
    });
  }
  return {
    auth,
    games,
    libraryLoaded,
    achievementsLoaded,
    queuesLoaded,
    game,
    achievements,
    queues,
    queueDetailsLoading,
    achievementFor: library.achievementFor,
    queue,
    preview,
    result,
    resultGame,
    history: history.records,
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
    remove,
    saveDates,
    prepareApply,
    apply,
    showHistory,
    setView,
    cancelPreview: () => setPreview(null),
    clearError: () => setError(null),
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
