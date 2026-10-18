import type { DesktopApi, DesktopPlatform, IpcResult } from '../../shared/api';
import type { IpcApi } from '../../shared/ipc.generated';

async function request<T>(invoke: () => Promise<IpcResult<T>>): Promise<T> {
  let result: IpcResult<T>;
  try {
    result = await invoke();
  } catch {
    throw new Error('The desktop service did not return a result.');
  }
  if (!result || typeof result.ok !== 'boolean')
    throw new Error('The desktop service returned an invalid result.');
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.data;
}

// The UI and demo share one application API; only this adapter knows the transport.
export function createDesktopApi(bridge: IpcApi, platform: DesktopPlatform): DesktopApi {
  const { workspace } = bridge;
  return {
    isDemo: platform.isDemo,
    initialize: () => request(() => workspace.initialize()),
    checkForUpdates: () => request(() => workspace.checkForUpdates()),
    getCliUpdateState: () => request(() => workspace.getCliUpdateState()),
    login: () => request(() => workspace.login()),
    logout: () => request(() => workspace.logout()),
    listGames: () => request(() => workspace.listGames()),
    listAchievements: (id) => request(() => workspace.listAchievements(id)),
    exportAchievements: (input) => request(() => workspace.exportAchievements(input)),
    getQueue: (id) => request(() => workspace.getQueue(id)),
    listQueues: () => request(() => workspace.listQueues()),
    addAchievements: (input) => request(() => workspace.addAchievements(input)),
    removeAchievements: (input) => request(() => workspace.removeAchievements(input)),
    setDates: (input) => request(() => workspace.setDates(input)),
    preview: (input) => request(() => workspace.preview(input)),
    apply: (input) => request(() => workspace.apply(input)),
    history: (input) => request(() => workspace.history(input)),
    checkCurrentState: (input) => request(() => workspace.checkCurrentState(input)),
    onOperation: (listener) => platform.onOperation(listener),
  };
}
