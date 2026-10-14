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
} from '../shared/api';

export type View = 'browse' | 'preview' | 'applying' | 'results' | 'history';
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
  const [games, setGames] = useState<Game[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [achievementsLoaded, setAchievementsLoaded] = useState(false);
  const [game, setGame] = useState<Game | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [history, setHistory] = useState<OperationRecord[]>([]);
  const [view, setView] = useState<View>('browse');
  const [loading, setLoading] = useState<string | null>('Checking GOG sign-in…');
  const [error, setError] = useState<Notice | null>(null);
  const [operation, setOperation] = useState<OperationState>({ kind: 'idle' });
  const [saved, setSaved] = useState(false);
  const [previewStale, setPreviewStale] = useState(false);
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
  function invalidate() {
    setPreview(null);
    setSaved(false);
    setPreviewStale(false);
  }
  function clearGameState() {
    generation.current += 1;
    currentGame.current = null;
    setGame(null);
    setAchievements([]);
    setAchievementsLoaded(false);
    setQueue(null);
    setHistory([]);
    setResult(null);
    setView('browse');
    invalidate();
  }
  function clearAccountState() {
    setGames([]);
    setLibraryLoaded(false);
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
        /* Never retain data from a different account when auth cannot be checked. */
      }
    }
    setError(detail);
  }
  async function run(label: string, task: () => Promise<void>) {
    if (
      working.current ||
      latestOperation.current.kind === 'apply' ||
      latestOperation.current.kind === 'recovery'
    )
      return;
    working.current = true;
    setLoading(label);
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
  async function loadGame(next: Game) {
    const sameGame = currentGame.current?.id === next.id;
    const stamp = ++generation.current;
    if (!sameGame) {
      currentGame.current = next;
      setGame(next);
      setAchievements([]);
      setAchievementsLoaded(false);
      setQueue(null);
      setHistory([]);
      setResult(null);
      setView('browse');
      invalidate();
    } else {
      setPreview(null);
      if (view === 'preview') setView('browse');
    }
    const data = await api.listAchievements(next.id);
    assertOwner(data.user_id);
    if (stamp !== generation.current) return;
    const nextQueue = await api.getQueue(next.id);
    if (nextQueue) assertOwner(nextQueue.user_id);
    if (stamp !== generation.current) return;
    const records = await api.history({ gameId: next.id });
    for (const record of records) assertOwner(record.user_id);
    if (stamp !== generation.current) return;
    currentGame.current = next;
    setGame(next);
    setAchievements(data.achievements);
    setQueue(nextQueue);
    setHistory(records);
    setAchievementsLoaded(true);
  }
  async function loadLibrary(preferredId?: string) {
    const data = await api.listGames();
    if (data.user_id !== currentAuth.current.user_id) {
      clearAccountState();
      currentAuth.current = { authenticated: false };
      setAuth(currentAuth.current);
      setAccount((await api.initialize()).auth);
    }
    assertOwner(data.user_id);
    setGames(data.games);
    setLibraryLoaded(true);
    const first = data.games.find((item) => item.id === preferredId) ?? data.games[0];
    if (first) await loadGame(first);
    else clearGameState();
  }
  const handleOperation = useEffectEvent((state: OperationState) => {
    const previous = latestOperation.current;
    latestOperation.current = state;
    setOperation(state);
    if (previous.kind === 'recovery' && state.kind === 'idle') {
      void run('Checking GOG sign-in…', async () => {
        const initial = await api.initialize();
        setAccount(initial.auth);
        if (initial.auth.authenticated) await loadLibrary(previous.gameId);
        else setView('browse');
      });
    }
  });
  const start = useEffectEvent(async (isMounted: () => boolean) => {
    working.current = true;
    setLoading('Checking GOG sign-in…');
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
      async () => {
        const status = await api.login();
        setAccount(status);
        if (status.authenticated) await loadLibrary();
      },
    );
  }
  function logout() {
    void run('Signing out…', async () => {
      setAccount(await api.logout());
    });
  }
  function selectGame(next: Game) {
    void run('Loading achievements…', () => loadGame(next));
  }
  function refreshLibrary() {
    void run('Loading library…', () => loadLibrary(game?.id));
  }
  function refreshAchievements(currentState = false) {
    if (!game) return;
    void run(currentState ? 'Checking current state…' : 'Refreshing achievements…', async () => {
      if (!achievementsLoaded) {
        await loadGame(game);
        return;
      }
      setPreview(null);
      const data = currentState
        ? await api.checkCurrentState({ gameId: game.id })
        : await api.listAchievements(game.id);
      assertOwner(data.user_id);
      const nextQueue = await api.getQueue(game.id);
      if (nextQueue) assertOwner(nextQueue.user_id);
      setAchievements(data.achievements);
      setQueue(nextQueue);
    });
  }
  async function mutate(task: () => Promise<Queue>): Promise<boolean> {
    const wasPreviewed = preview !== null;
    invalidate();
    setPreviewStale(wasPreviewed);
    let succeeded = false;
    await run('Saving queue…', async () => {
      try {
        const value = await task();
        assertOwner(value.user_id);
        setQueue(value);
        setSaved(true);
        succeeded = true;
      } catch (failure) {
        if (game && !['ACCOUNT_CHANGED', 'ACCOUNT_MISMATCH'].includes(notice(failure).code ?? '')) {
          try {
            const value = await api.getQueue(game.id);
            if (value) assertOwner(value.user_id);
            setQueue(value);
          } catch {
            /* Keep the last matching draft if the reload also fails. */
          }
        }
        throw failure;
      }
    });
    return succeeded;
  }
  function add(ids: string[]) {
    if (game) void mutate(() => api.addAchievements({ gameId: game.id, achievementIds: ids }));
  }
  function remove(ids: string[]) {
    if (game) void mutate(() => api.removeAchievements({ gameId: game.id, achievementIds: ids }));
  }
  async function saveDates(dates: Record<string, string>): Promise<boolean> {
    if (!game || working.current) return false;
    return mutate(() => api.setDates({ gameId: game.id, dates }));
  }
  function createPreview() {
    if (!game) return;
    void run('Checking changes…', async () => {
      const value = await api.preview({ gameId: game.id });
      assertOwner(value.report.user_id);
      setPreview(value);
      setPreviewStale(false);
      setView('preview');
    });
  }
  function apply() {
    if (!preview || working.current) return;
    const token = preview.token;
    setView('applying');
    setPreview(null);
    void run('Applying changes…', async () => {
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
      if (game) {
        try {
          // Show durable local cleanup even if the later network refresh fails.
          const nextQueue = await api.getQueue(game.id);
          if (nextQueue) assertOwner(nextQueue.user_id);
          setQueue(nextQueue);
          const records = await api.history({ gameId: game.id });
          for (const record of records) assertOwner(record.user_id);
          setHistory(records);
          const data = await api.listAchievements(game.id);
          assertOwner(data.user_id);
          setAchievements(data.achievements);
        } catch (failure) {
          await handleFailure(failure);
        }
      }
    });
  }
  function viewRecord(record: OperationRecord) {
    setResult({
      operationId: record.id,
      state: record.state === 'complete' ? 'complete' : 'unknown',
      report: record.report,
      error: record.error,
    });
    setView('results');
  }
  return {
    auth,
    games,
    libraryLoaded,
    achievementsLoaded,
    game,
    achievements,
    queue,
    preview,
    result,
    history,
    view,
    loading,
    error,
    operation,
    saved,
    previewStale,
    versions,
    busy,
    active,
    login,
    logout,
    selectGame,
    refreshLibrary,
    refreshAchievements,
    add,
    remove,
    saveDates,
    createPreview,
    apply,
    setView,
    viewRecord,
    clearError: () => setError(null),
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
