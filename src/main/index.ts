import 'reflect-metadata';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { createDesktopApplication, type DesktopApplication } from './application';
import { IPC_OPERATION, type OperationState } from '../shared/api';
import { installUpdates } from './update-menu';
import packageMetadata from '../../package.json';
import { resolveCli } from './cli-client';
import { CliUpdateManager } from './cli-updates/manager';
import { CLI_VERSION } from '../shared/cli-release';
import { disabledCliUpdates } from '../shared/cli-updates';
const mainDirectory = dirname(fileURLToPath(import.meta.url));
const demo = process.env.GOG_ACHIEVEMENTS_DEMO === '1';
let window: BrowserWindow | null = null;
let operation: OperationState = { kind: 'idle' };
let guardDialog = false;
let desktop: DesktopApplication | undefined;
let closing = false;
let updates: ReturnType<typeof installUpdates> | undefined;
let cliUpdates: CliUpdateManager | undefined;
// Keep saved queues and history in the original folder when the display name changes.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  const userData = join(app.getPath('appData'), packageMetadata.name);
  mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  app.setPath('sessionData', userData);
}
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
      const preload = join(mainDirectory, '../preload/index.cjs');
      if (!existsSync(preload)) throw new Error('The preload bundle is missing.');
      window = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1120,
        minHeight: 720,
        title: 'GOG Achievements',
        autoHideMenuBar: process.platform === 'win32',
        backgroundColor: '#f2f4f8',
        webPreferences: {
          preload,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          devTools: !app.isPackaged,
          additionalArguments: demo ? ['--gog-achievements-demo'] : [],
        },
      });
      const currentWindow = window;
      const cli = {
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        projectPath: app.getAppPath(),
        developmentDirectory: app.isPackaged
          ? undefined
          : process.env.GOG_ACHIEVEMENTS_DEV_CLI_DIRECTORY,
      };
      if (!demo)
        cliUpdates = new CliUpdateManager({
          supported: app.isPackaged,
          userDataPath: app.getPath('userData'),
          resolveBundled: () => resolveCli(cli),
        });
      const cliSelection = await cliUpdates?.prepare();
      updates = installUpdates({
        app,
        dialog,
        Menu,
        shell,
        getWindow: () => window,
        isBusy: () => operation.kind !== 'idle',
        repository: new URL(packageMetadata.repository.url).pathname.replace(/^\/|\.git$/g, ''),
        enabled: !demo,
        cliUpdates,
      });
      desktop = await createDesktopApplication({
        window: currentWindow,
        appActions: {
          checkForUpdates: updates.checkForUpdates,
          getCliUpdateState: async () => cliUpdates?.snapshot() ?? disabledCliUpdates(CLI_VERSION),
        },
        demo,
        version: app.getVersion(),
        userDataPath: app.getPath('userData'),
        chooseExportFile: async (gameId) => {
          const result = await dialog.showSaveDialog(currentWindow, {
            title: 'Export achievements as CSV',
            defaultPath: join(app.getPath('downloads'), `achievements-${gameId}.csv`),
            filters: [{ name: 'CSV', extensions: ['csv'] }],
            message:
              'The CSV includes hidden achievement names and descriptions. Choose a new file name.',
          });
          return result.canceled ? null : (result.filePath ?? null);
        },
        cli,
        cliSelection,
      });
      const { api } = desktop;
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
    } else if (desktop && !closing) {
      event.preventDefault();
      closing = true;
      void desktop.close().then(
        () => app.quit(),
        () => app.exit(1),
      );
    }
  });
  app.on('will-quit', () => {
    cliUpdates?.close();
    updates?.cleanup();
  });
  app.on('window-all-closed', () => {
    app.quit();
  });
}
