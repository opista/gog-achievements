import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_REQUEST,
  IPC_OPERATION,
  type DesktopApi,
  type IpcResult,
  type OperationState,
  type ApiMethod,
} from '../shared/api';
async function invoke<T>(method: ApiMethod, payload?: unknown): Promise<T> {
  let result: IpcResult;
  try {
    result = (await ipcRenderer.invoke(IPC_REQUEST, { method, payload })) as IpcResult;
  } catch {
    throw new Error('The desktop service did not return a result.');
  }
  if (!result || typeof result.ok !== 'boolean')
    throw new Error('The desktop service returned an invalid result.');
  if (!result.ok) {
    const error = new Error(result.error.message);
    Object.assign(error, { code: result.error.code });
    throw error;
  }
  return result.data as T;
}
const api: DesktopApi = {
  isDemo: process.argv.includes('--gog-achievements-demo'),
  initialize: () => invoke('initialize'),
  checkForUpdates: () => invoke('checkForUpdates'),
  login: () => invoke('login'),
  logout: () => invoke('logout'),
  listGames: () => invoke('listGames'),
  listAchievements: (id) => invoke('listAchievements', id),
  getQueue: (id) => invoke('getQueue', id),
  listQueues: () => invoke('listQueues'),
  addAchievements: (input) => invoke('addAchievements', input),
  removeAchievements: (input) => invoke('removeAchievements', input),
  setDates: (input) => invoke('setDates', input),
  preview: (input) => invoke('preview', input),
  apply: (input) => invoke('apply', input),
  history: (input) => invoke('history', input),
  checkCurrentState: (input) => invoke('checkCurrentState', input),
  onOperation(listener) {
    const receive = (_event: Electron.IpcRendererEvent, value: OperationState): void => {
      if (value && ['idle', 'read', 'login', 'apply', 'recovery'].includes(value.kind))
        listener(value);
    };
    ipcRenderer.on(IPC_OPERATION, receive);
    return () => {
      ipcRenderer.removeListener(IPC_OPERATION, receive);
    };
  },
};
contextBridge.exposeInMainWorld('gogAchievements', api);
