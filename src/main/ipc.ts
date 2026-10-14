import type { IpcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import type { DesktopApi, ApiMethod, IpcResult } from '../shared/api';
import { IPC_REQUEST } from '../shared/api';
import { ipcSchemas } from '../shared/schemas';
import { publicError, DesktopError } from './errors';
export function trustedSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  window: BrowserWindow,
): boolean {
  return (
    event.sender === window.webContents &&
    event.senderFrame !== null &&
    event.senderFrame === window.webContents.mainFrame
  );
}
export function installIpc(ipcMain: IpcMain, window: BrowserWindow, api: DesktopApi): void {
  const handlers: Record<ApiMethod, (payload: unknown) => Promise<unknown>> = {
    initialize: () => api.initialize(),
    login: () => api.login(),
    logout: () => api.logout(),
    listGames: () => api.listGames(),
    listAchievements: (value) => api.listAchievements(ipcSchemas.listAchievements.parse(value)),
    getQueue: (value) => api.getQueue(ipcSchemas.getQueue.parse(value)),
    addAchievements: (value) => api.addAchievements(ipcSchemas.addAchievements.parse(value)),
    removeAchievements: (value) =>
      api.removeAchievements(ipcSchemas.removeAchievements.parse(value)),
    setDates: (value) => api.setDates(ipcSchemas.setDates.parse(value)),
    preview: (value) => api.preview(ipcSchemas.preview.parse(value)),
    apply: (value) => api.apply(ipcSchemas.apply.parse(value)),
    history: (value) => api.history(ipcSchemas.history.parse(value)),
    checkCurrentState: (value) => api.checkCurrentState(ipcSchemas.checkCurrentState.parse(value)),
  };
  ipcMain.removeHandler(IPC_REQUEST);
  ipcMain.handle(IPC_REQUEST, async (event, request: unknown): Promise<IpcResult> => {
    try {
      if (!trustedSender(event, window))
        throw new DesktopError('IPC_DENIED', 'This request is not allowed.');
      if (
        !request ||
        typeof request !== 'object' ||
        Object.keys(request).some((key) => !['method', 'payload'].includes(key))
      )
        throw new DesktopError('INVALID_REQUEST', 'The app request is invalid.');
      const { method, payload } = request as { method?: unknown; payload?: unknown };
      if (typeof method !== 'string' || !Object.hasOwn(handlers, method))
        throw new DesktopError('INVALID_REQUEST', 'The app request is invalid.');
      const key = method as ApiMethod;
      if (!ipcSchemas[key].safeParse(payload).success)
        throw new DesktopError('INVALID_INPUT', 'Check the selected IDs and date values.');
      return { ok: true, data: await handlers[key](payload) };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });
}
