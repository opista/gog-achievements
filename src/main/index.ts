import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { CliClient, resolveCli } from './cli-client';
import { QueueStore } from './queue-store';
import { OperationManager } from './operation-manager';
import { installIpc } from './ipc';
import { createDemoApi } from '../shared/demo-api';
import { IPC_OPERATION, type WorkspaceApi, type OperationState } from '../shared/api';
import { DesktopError } from './errors';
import { installUpdates } from './update-menu';
import packageMetadata from '../../package.json';
const mainDirectory = dirname(fileURLToPath(import.meta.url));
const demo = process.env.GOG_ACHIEVEMENTS_DEMO === '1';
let window: BrowserWindow | null = null;
let operation: OperationState = { kind: 'idle' };
let guardDialog = false;
let manager: OperationManager | undefined;
let recoveryTimer: ReturnType<typeof setInterval> | undefined;
let updates: ReturnType<typeof installUpdates> | undefined;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  void app
    .whenReady()
    .then(async () => {
      let api: WorkspaceApi;
      if (demo) api = createDemoApi();
      else {
        // Resolving the bundled CLI never falls back to PATH or a source checkout.
        let executable: string;
        try {
          executable = await resolveCli({
            packaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            projectPath: app.getAppPath(),
          });
        } catch {
          executable = '';
        }
        const client = executable
          ? new CliClient(executable)
          : {
              run: async () => {
                throw new DesktopError(
                  'CLI_PACKAGE_INVALID',
                  'The bundled CLI is missing or does not match this app. Reinstall the app.',
                );
              },
            };
        manager = new OperationManager(
          client,
          new QueueStore(join(app.getPath('userData'), 'queues')),
          app.getVersion(),
        );
        api = manager;
        recoveryTimer = setInterval(() => {
          void manager?.refreshRecovery().catch(() => {});
        }, 3000);
        recoveryTimer.unref();
      }
      const preload = join(mainDirectory, '../preload/index.cjs');
      if (!existsSync(preload)) throw new Error('The preload bundle is missing.');
      window = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1120,
        minHeight: 720,
        title: 'GOG Achievements',
        backgroundColor: '#f2f4f8',
        webPreferences: {
          preload,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          additionalArguments: demo ? ['--gog-achievements-demo'] : [],
        },
      });
      const currentWindow = window;
      updates = installUpdates({
        app,
        dialog,
        Menu,
        shell,
        getWindow: () => window,
        isBusy: () => operation.kind !== 'idle',
        repository: new URL(packageMetadata.repository.url).pathname.replace(/^\/|\.git$/g, ''),
      });
      installIpc(ipcMain, currentWindow, api, updates);
      const unsubscribe = api.onOperation((state) => {
        operation = state;
        if (state.kind === 'idle') updates?.onIdle();
        if (!currentWindow.isDestroyed()) currentWindow.webContents.send(IPC_OPERATION, state);
      });
      currentWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      currentWindow.webContents.on('will-navigate', (event) => {
        event.preventDefault();
      });
      currentWindow.on('close', (event) => {
        if (operation.kind !== 'idle') {
          event.preventDefault();
          if (!guardDialog) {
            guardDialog = true;
            void dialog
              .showMessageBox(currentWindow, {
                type: 'info',
                title: 'Operation active',
                message:
                  operation.kind === 'login'
                    ? 'Finish or close the GOG sign-in window before closing this app.'
                    : operation.kind === 'read'
                      ? 'A CLI operation is still running. Wait for its result before closing.'
                      : 'Changes may still be applying. Keep this app open until the result is available.',
                buttons: ['Keep open'],
              })
              .finally(() => {
                guardDialog = false;
              });
          }
        }
      });
      currentWindow.on('closed', () => {
        unsubscribe();
        window = null;
      });
      const developmentUrl = process.env.ELECTRON_RENDERER_URL;
      if (!app.isPackaged && developmentUrl) await currentWindow.loadURL(developmentUrl);
      else await currentWindow.loadFile(join(mainDirectory, '../renderer/index.html'));
    })
    .catch(() => {
      void dialog.showErrorBox(
        'GOG Achievements could not start',
        'The application files could not load. Reinstall the app or rebuild the development project.',
      );
      app.exit(1);
    });
  app.on('before-quit', (event) => {
    if (operation.kind !== 'idle') {
      event.preventDefault();
      window?.close();
    }
  });
  app.on('will-quit', () => {
    updates?.cleanup();
    if (recoveryTimer) clearInterval(recoveryTimer);
  });
  app.on('window-all-closed', () => {
    app.quit();
  });
}
