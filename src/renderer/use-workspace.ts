import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type {
  Achievement,
  ApplyResult,
  AuthStatus,
  DesktopApi,
  Game,
  InitializeResult,
  OperationRecord,
  OperationState,
  PreviewResult,
  Queue,
  QueueGame,
} from '../shared/api';

export type View = 'browse' | 'applying' | 'results' | 'history';
export type LoadingTarget =
  'session' | 'library' | 'achievements' | 'queue' | 'history' | 'preview' | 'apply';
export interface Notice {
  message: string;
  code?: string;
}
function notice(error: unknown): Notice {
  if (error instanceof Error)
    return {
      message: error.message,
      code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    };
  return { message: 'The operation could not be completed.' };
}
export function useWorkspace(api: DesktopApi) {
  const [auth, setAuth] = useState<AuthStatus>({ authenticated: false });
  const currentAuth = useRef<AuthStatus>({ authenticated: false });
  const currentGame = useRef<Game | null>(null);
  const gameMetadata = useRef(new Map<string, QueueGame>());
  const [games, setGames] = useState<Game[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [achievementsLoaded, setAchievementsLoaded] = useState(false);
  const [queuesLoaded, setQueuesLoaded] = useState(false);
  const [game, setGame] = useState<Game | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [achievementCache, setAchievementCache] = useState<Record<string, Achievement[]>>({});
  const [queueDetailsLoading, setQueueDetailsLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [resultGame, setResultGame] = useState<QueueGame | null>(null);
  const [history, setHistory] = useState<OperationRecord[]>([]);
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
  const [versions, setVersions] = useState({ app: '', cli: '' });
  const generation = useRef(0);
  const working = useRef(false);
  const initialization = useRef<{ api: DesktopApi; promise: Promise<InitializeResult> } | null>(
    null,
  );
  const latestOperation = useRef(operation);
  latestOperation.current = operation;
  const active =
    operation.kind === 'apply' || operation.kind === 'recovery' || operation.kind === 'login';
  const busy = loading !== null || operation.kind !== 'idle';
  const queue = queues.find((item) => item.game.id === game?.id) ?? null;
  function invalidate() {
    setPreview(null);
  }
  function clearGameState() {
    generation.current += 1;
    currentGame.current = null;
    setGame(null);
    setAchievements([]);
    setAchievementsLoaded(false);
    setResult(null);
    setResultGame(null);
    setView('browse');
    invalidate();
  }
  function clearAccountState() {
    setGames([]);
    setLibraryLoaded(false);
    setQueues([]);
    setQueuesLoaded(false);
    setHistory([]);
    setAchievementCache({});
    gameMetadata.current.clear();
    clearGameState();
  }
  function setAccount(status: AuthStatus) {
    if (status.user_id !== currentAuth.current.user_id || !status.authenticated)
      clearAccountState();
    currentAuth.current = status;
    setAuth(status);
  }
  function accountChanged(): never {
    clearAccountState();
    currentAuth.current = { authenticated: false };
    setAuth(currentAuth.current);
    throw Object.assign(
      new Error('The GOG account changed. Refresh the library to load matching account data.'),
      { code: 'ACCOUNT_CHANGED' },
    );
  }
  function assertOwner(userId: string) {
    if (!currentAuth.current.authenticated || userId !== currentAuth.current.user_id)
      accountChanged();
  }
  async function handleFailure(failure: unknown) {
    const detail = notice(failure);
    if (detail.code === 'ACCOUNT_CHANGED' || detail.code === 'ACCOUNT_MISMATCH') {
      clearAccountState();
      currentAuth.current = { authenticated: false };
      setAuth(currentAuth.current);
      try {
        setAccount((await api.initialize()).auth);
      } catch {
        /* Keep other-account data cleared. */
      }
    }
    setError(detail);
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
    if (value) assertOwner(value.user_id);
    setQueues((previous) => [
      ...previous.filter((item) => item.game.id !== gameId),
      ...(value ? [value] : []),
    ]);
  }
  async function loadQueues() {
    const values = await api.listQueues();
    for (const value of values) assertOwner(value.user_id);
    setQueues(values);
    setQueuesLoaded(true);
    return values;
  }
  async function loadQueueDetails(values: Queue[]) {
    const missing = values.filter(
      (value) =>
        value.items.length &&
        value.game.id !== currentGame.current?.id &&
        !achievementCache[value.game.id],
    );
    if (!missing.length) return;
    setLoadingTarget('queue');
    setQueueDetailsLoading(true);
    try {
      for (const value of missing) {
        try {
          const data = await api.listAchievements(value.game.id);
          assertOwner(data.user_id);
          setAchievementCache((previous) => ({ ...previous, [value.game.id]: data.achievements }));
        } catch (failure) {
          if (['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH'].includes(notice(failure).code ?? ''))
            throw failure;
          // Saved requests stay usable when optional descriptions cannot be read.
        }
      }
    } finally {
      setQueueDetailsLoading(false);
    }
  }
  async function loadHistory() {
    const records = await api.history({});
    for (const record of records) assertOwner(record.user_id);
    setHistory(records);
  }
  async function loadGame(next: Game) {
    const sameGame = currentGame.current?.id === next.id;
    const stamp = ++generation.current;
    setLoadingTarget('achievements');
    if (!sameGame) {
      currentGame.current = next;
      setGame(next);
      setAchievements([]);
      setAchievementsLoaded(false);
      setResult(null);
      setResultGame(null);
      setView('browse');
      invalidate();
    } else setPreview(null);
    const data = await api.listAchievements(next.id);
    assertOwner(data.user_id);
    if (stamp !== generation.current) return;
    gameMetadata.current.set(next.id, data.game);
    const nextQueue = await api.getQueue(next.id);
    if (stamp !== generation.current) return;
    updateQueue(next.id, nextQueue);
    currentGame.current = next;
    setGame(next);
    setAchievements(data.achievements);
    setAchievementCache((previous) => ({ ...previous, [next.id]: data.achievements }));
    setAchievementsLoaded(true);
  }
  async function loadLibrary(preferredId?: string) {
    setLoadingTarget('library');
    let data;
    try {
      data = await api.listGames();
    } catch (failure) {
      // A failed network library read must not hide readable local drafts.
      if (
        !['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH', 'AUTH_REQUIRED'].includes(
          notice(failure).code ?? '',
        )
      ) {
        try {
          await loadQueues();
          await loadHistory();
        } catch (localFailure) {
          if (['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH'].includes(notice(localFailure).code ?? ''))
            throw localFailure;
        }
      }
      throw failure;
    }
    if (data.user_id !== currentAuth.current.user_id) {
      clearAccountState();
      currentAuth.current = { authenticated: false };
      setAuth(currentAuth.current);
      setAccount((await api.initialize()).auth);
    }
    assertOwner(data.user_id);
    setGames(data.games);
    setLibraryLoaded(true);
    const savedQueues = await loadQueues();
    await loadHistory();
    const first = data.games.find((item) => item.id === preferredId) ?? data.games[0];
    if (!first) clearGameState();
    else if (currentGame.current?.id !== first.id || !achievementsLoaded) await loadGame(first);
    await loadQueueDetails(savedQueues);
  }
  const handleOperation = useEffectEvent((state: OperationState) => {
    const previous = latestOperation.current;
    latestOperation.current = state;
    setOperation(state);
    if (previous.kind === 'recovery' && state.kind === 'idle')
      void run('Checking GOG sign-in…', 'session', async () => {
        const initial = await api.initialize();
        setAccount(initial.auth);
        if (initial.auth.authenticated) await loadLibrary(previous.gameId);
        else setView('browse');
      });
  });
  const start = useEffectEvent(async (isMounted: () => boolean) => {
    working.current = true;
    setLoading('Checking GOG sign-in…');
    setLoadingTarget('session');
    try {
      if (initialization.current?.api !== api)
        initialization.current = { api, promise: api.initialize() };
      const initial = await initialization.current.promise;
      if (!isMounted()) return;
      setAccount(initial.auth);
      setOperation(initial.operation);
      latestOperation.current = initial.operation;
      setVersions({ app: initial.version, cli: initial.cliVersion });
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
      generation.current += 1;
      unsubscribe();
    };
  }, [api]);
  function login() {
    void run(
      api.isDemo ? 'Connecting demo account…' : 'Complete sign-in in the GOG window.',
      'session',
      async () => {
        const status = await api.login();
        setAccount(status);
        if (status.authenticated) await loadLibrary();
      },
    );
  }
  function logout() {
    void run('Signing out…', 'session', async () => {
      setAccount(await api.logout());
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
    const selected = currentGame.current;
    if (!selected) return;
    void run(
      currentState ? 'Checking current state…' : 'Refreshing achievements…',
      'achievements',
      async () => {
        if (!achievementsLoaded) {
          await loadGame(selected);
          return;
        }
        setPreview(null);
        const data = currentState
          ? await api.checkCurrentState({ gameId: selected.id })
          : await api.listAchievements(selected.id);
        assertOwner(data.user_id);
        const nextQueue = await api.getQueue(selected.id);
        updateQueue(selected.id, nextQueue);
        setAchievements(data.achievements);
        setAchievementCache((previous) => ({ ...previous, [selected.id]: data.achievements }));
      },
    );
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
        if (!['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH'].includes(notice(failure).code ?? '')) {
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
    const metadata = gameMetadata.current.get(game.id);
    const timestamp = new Date().toISOString();
    const provisional: Queue | undefined =
      metadata && currentAuth.current.user_id
        ? {
            schema_version: 1,
            user_id: currentAuth.current.user_id,
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
        assertOwner(value.report.user_id);
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
        if (value.report) assertOwner(value.report.user_id);
        setResult(value);
      } catch (failure) {
        if (['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH'].includes(notice(failure).code ?? ''))
          throw failure;
        setResult({
          operationId: '',
          state: 'unknown',
          report: null,
          error: {
            code: notice(failure).code ?? 'UNKNOWN_OUTCOME',
            message: notice(failure).message,
          },
        });
      }
      setView('results');
      try {
        // Refresh durable local state first; a later network failure must not restore stale rows.
        updateQueue(report.game.id, await api.getQueue(report.game.id));
        await loadHistory();
        if (currentGame.current?.id === report.game.id) {
          const data = await api.listAchievements(report.game.id);
          assertOwner(data.user_id);
          setAchievements(data.achievements);
          setAchievementCache((previous) => ({ ...previous, [report.game.id]: data.achievements }));
        }
      } catch (failure) {
        await handleFailure(failure);
      }
    });
  }
  function showHistory() {
    void run('Loading history…', 'history', async () => {
      setView('history');
      await loadHistory();
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
    achievementFor: (gameId: string, achievementId: string) =>
      achievementCache[gameId]?.find((item) => item.id === achievementId),
    queue,
    preview,
    result,
    resultGame,
    history,
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
