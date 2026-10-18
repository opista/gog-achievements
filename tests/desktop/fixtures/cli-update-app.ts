import 'reflect-metadata';
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { createDesktopApplication, type DesktopApplication } from '../../../src/main/application';
import { CliUpdateManager } from '../../../src/main/cli-updates/manager';
import { IPC_OPERATION } from '../../../src/shared/api';
import { FakeCli } from '../../main/fixtures';
import { cliPackage, writeDownload } from '../../main/cli-update-fixtures';

export interface UpdateFixture {
  start(): void;
  finish(): Promise<void>;
  snapshot(): ReturnType<CliUpdateManager['snapshot']>;
  writes(): number;
}

const project = process.env.GOG_UPDATE_FIXTURE_PROJECT!;
const old = new FakeCli();
old.version = '0.5.1';
const next = new FakeCli();
next.version = '0.6.0';
next.supportsExporting = true;
let desktop: DesktopApplication;
let manager: CliUpdateManager;
let releaseDownload!: () => void;
let updating: Promise<unknown> | undefined;
const download = new Promise<void>((resolve) => {
  releaseDownload = resolve;
});

app.setName('GOG Achievements');
void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    webPreferences: {
      preload: join(project, 'out/preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const target = `${process.platform === 'darwin' ? 'macos' : 'windows'}-${process.arch}`;
  const fixture = cliPackage('0.6.0', target);
  manager = new CliUpdateManager({
    supported: true,
    userDataPath: app.getPath('userData'),
    resolveBundled: async () => '/fixture/bundled',
    verify: async () => {}, // Dummy package bytes are never executed; FakeCli implements the port.
    client: {
      latest: async () => fixture.release,
      download: async (_release, path) => {
        await download;
        return writeDownload(path, fixture);
      },
    },
    activate: (activation) => desktop.activateCli(activation),
  });
  const selection = await manager.prepare();
  desktop = await createDesktopApplication({
    window,
    demo: false,
    version: '0.3.1',
    userDataPath: app.getPath('userData'),
    cli: { packaged: false, resourcesPath: '', projectPath: project },
    cliSelection: selection,
    createCli: () => old,
    createReplacementCli: () => next,
    appActions: {
      checkForUpdates: async () => {},
      getCliUpdateState: async () => manager.snapshot(),
      setCliActivationBlocked: (input) => desktop.setCliActivationBlocked(input),
    },
  });
  desktop.api.onOperation((state) => {
    if (!window.isDestroyed()) window.webContents.send(IPC_OPERATION, state);
    if (state.kind === 'idle') void manager.activatePending();
  });
  Object.assign(app, {
    updateFixture: {
      start() {
        updating = manager.check();
      },
      async finish() {
        releaseDownload();
        await updating;
      },
      snapshot: () => manager.snapshot(),
      writes: () =>
        [...old.calls, ...next.calls].filter(({ kind }) => kind === 'queue-apply').length,
    } satisfies UpdateFixture,
  });
  await window.loadFile(join(project, 'out/renderer/index.html'));
});
let closing = false;
app.on('before-quit', (event) => {
  if (closing || !desktop) return;
  event.preventDefault();
  closing = true;
  manager.close();
  void desktop.close().then(() => app.quit());
});
