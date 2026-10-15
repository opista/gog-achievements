import { contextBridge, ipcRenderer } from 'electron';
import { setupPreload } from '@electron-ipc-bridge/core/preload';
import { IPC_OPERATION, type DesktopPlatform, type OperationState } from '../shared/api';

// Contract discovery is asynchronous. Expose readiness before the renderer runs.
const ready = setupPreload().then(
  () => true,
  () => false,
);
const platform: DesktopPlatform = {
  isDemo: process.argv.includes('--gog-achievements-demo'),
  async ready() {
    if (!(await ready)) throw new Error('The desktop bridge could not load. Restart the app.');
  },
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
contextBridge.exposeInMainWorld('gogPlatform', platform);
