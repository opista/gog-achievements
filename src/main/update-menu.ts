import type {
  App,
  BrowserWindow,
  Dialog,
  Menu as NativeMenu,
  MenuItem,
  MenuItemConstructorOptions,
  MessageBoxOptions,
  Shell,
} from 'electron';
import { UpdateService, UPDATE_CHECK_FAILED_MESSAGE, type UpdateCheck } from './update-service';
import type { CliUpdateState } from '../shared/cli-updates';

interface UpdateMenuOptions {
  app: Pick<App, 'isPackaged' | 'getVersion'>;
  dialog: Pick<Dialog, 'showMessageBox'>;
  Menu: Pick<typeof NativeMenu, 'getApplicationMenu' | 'buildFromTemplate' | 'setApplicationMenu'>;
  shell: Pick<Shell, 'openExternal'>;
  getWindow: () => BrowserWindow | null | undefined;
  isBusy: () => boolean;
  repository: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  service?: Pick<UpdateService, 'check' | 'openDownload'>;
  enabled?: boolean;
  cliUpdates?: { check(manual?: boolean): Promise<CliUpdateState> };
}

type Notice =
  { result: UpdateCheck; manual: boolean; cli?: CliUpdateState } | { development: true };
const updateItemId = 'check-for-updates';

function standardMenu(mac: boolean, packaged: boolean): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      role: 'viewMenu',
      ...(packaged
        ? {
            submenu: [
              { role: 'resetZoom' as const },
              { role: 'zoomIn' as const },
              { role: 'zoomOut' as const },
              { type: 'separator' as const },
              { role: 'togglefullscreen' as const },
            ],
          }
        : {}),
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [] },
  ];
  if (mac) {
    template.unshift({
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }
  return template;
}

/** Native update notices use the service's retained download URL, never a renderer URL. */
export function installUpdates(options: UpdateMenuOptions) {
  const { app, dialog, Menu, getWindow, isBusy } = options;
  const platform = options.platform ?? process.platform;
  const service =
    options.service ??
    new UpdateService({
      currentVersion: app.getVersion(),
      repository: options.repository,
      platform,
      architecture: options.architecture ?? process.arch,
      openExternal: (url) => options.shell.openExternal(url),
    });
  const notices = new AbortController();
  let disposed = false;
  let pending: Notice | undefined;
  let checking: Promise<void> | undefined;
  let presenting: Promise<void> | undefined;
  let manualRequested = false;
  let announcedVersion: string | undefined;

  async function showMessage(options: MessageBoxOptions) {
    const window = getWindow();
    const message = { ...options, signal: notices.signal, noLink: true };
    return window && !window.isDestroyed()
      ? dialog.showMessageBox(window, message)
      : dialog.showMessageBox(message);
  }

  function presentPending(): Promise<void> {
    if (disposed || isBusy() || !pending) return Promise.resolve();
    if (presenting) return presenting;
    const notice = pending;
    pending = undefined;
    presenting = (async () => {
      if ('development' in notice) {
        await showMessage({
          type: 'info',
          title: 'Check for Updates',
          message: 'Update checks are available in the installed app.',
          buttons: ['OK'],
        });
        return;
      }
      const result = notice.result;
      const cliDetail = notice.cli
        ? `CLI ${notice.cli.currentVersion}: ${notice.cli.message}`
        : undefined;
      if (result.status !== 'available') {
        await showMessage({
          type: ['unavailable', 'no-release'].includes(result.status) ? 'warning' : 'info',
          title: 'Check for Updates',
          message: result.message,
          ...(cliDetail ? { detail: cliDetail } : {}),
          buttons: ['OK'],
        });
        return;
      }
      const version = result.latestVersion ?? result.downloadUrl ?? result.message;
      if (!notice.manual && announcedVersion === version) return;
      announcedVersion = version;
      const answer = await showMessage({
        type: 'info',
        title: 'Update available',
        message: result.latestVersion
          ? `GOG Achievements ${result.latestVersion} is available.`
          : 'A new version of GOG Achievements is available.',
        detail: ['Download the new version in your browser, then open it to install.', cliDetail]
          .filter(Boolean)
          .join('\n\n'),
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (disposed || answer.response !== 0) return;
      const opened = await service.openDownload().catch(() => false);
      if (!disposed && !opened) {
        await showMessage({
          type: 'warning',
          title: 'Download could not open',
          message: 'The download could not open in your browser.',
          detail: 'Check for updates again, then try Download.',
          buttons: ['OK'],
        });
      }
    })()
      .catch(() => {})
      .finally(() => {
        presenting = undefined;
      });
    return presenting;
  }

  function check(manual: boolean): Promise<void> {
    if (disposed) return Promise.resolve();
    if (presenting) return presenting;
    if (checking) {
      manualRequested ||= manual;
      return checking;
    }
    if (!app.isPackaged || options.enabled === false) {
      if (manual) pending = { development: true };
      return presentPending();
    }
    if (manual && pending) {
      if ('result' in pending) pending.manual = true;
      return presentPending();
    }
    manualRequested = manual;
    checking = (async () => {
      const appCheck = service.check().catch((): UpdateCheck => ({
        status: 'unavailable',
        currentVersion: app.getVersion(),
        message: UPDATE_CHECK_FAILED_MESSAGE,
      }));
      const cliCheck = options.cliUpdates?.check(manual).catch(() => undefined);
      const [result, cliResult] = await Promise.all([appCheck, cliCheck]);
      // A manual request can join an automatic app check while CLI updates are off.
      const cli =
        manualRequested && !manual && cliResult?.automatic === false
          ? await options.cliUpdates?.check(true).catch(() => undefined)
          : cliResult;
      if (disposed) return;
      if (result.status === 'available' || manualRequested) {
        pending = { result, manual: manualRequested, ...(cli ? { cli } : {}) };
        await presentPending();
      }
    })().finally(() => {
      checking = undefined;
      manualRequested = false;
    });
    return checking;
  }

  const previousMenu = Menu.getApplicationMenu();
  const mac = platform === 'darwin';
  const template: (MenuItemConstructorOptions | MenuItem)[] =
    !app.isPackaged && previousMenu ? [...previousMenu.items] : standardMenu(mac, app.isPackaged);
  let hostIndex = mac
    ? template.findIndex((item) => item.role === 'appMenu')
    : template.findIndex(
        (item) => item.role === 'help' || item.label?.replaceAll('&', '') === 'Help',
      );
  if (mac && hostIndex < 0 && template.length) hostIndex = 0;
  if (hostIndex < 0) {
    const host: MenuItemConstructorOptions = { role: mac ? 'appMenu' : 'help', submenu: [] };
    if (mac) {
      template.unshift(host);
      hostIndex = 0;
    } else hostIndex = template.push(host) - 1;
  }
  const host = template[hostIndex]!;
  const originalItems = Array.isArray(host.submenu) ? host.submenu : (host.submenu?.items ?? []);
  const items = originalItems.filter((item) => item.id !== updateItemId);
  const entry: MenuItemConstructorOptions = {
    id: updateItemId,
    label: 'Check for Updates…',
    click: () => void check(true),
  };
  if (mac) {
    const about = items.findIndex((item) => item.role === 'about');
    items.splice(about + 1, 0, entry);
  } else {
    if (items.length && items.at(-1)?.type !== 'separator') items.push({ type: 'separator' });
    items.push(entry);
  }
  // Keep existing MenuItem instances so native callbacks, roles and checkbox state stay intact.
  template[hostIndex] = {
    id: host.id,
    role: host.role,
    label: host.label,
    sublabel: host.sublabel,
    toolTip: host.toolTip,
    accessibilityLabel: host.accessibilityLabel,
    accelerator: host.accelerator ?? undefined,
    icon: host.icon,
    enabled: host.enabled,
    visible: host.visible,
    registerAccelerator: host.registerAccelerator,
    badge: host.badge,
    submenu: Menu.buildFromTemplate(items),
  };
  const installedMenu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(installedMenu);
  if (app.isPackaged && options.enabled !== false) void check(false);

  return {
    checkForUpdates: () => check(true),
    onIdle: () => void presentPending(),
    cleanup() {
      if (disposed) return;
      disposed = true;
      pending = undefined;
      notices.abort();
      if (Menu.getApplicationMenu() === installedMenu) Menu.setApplicationMenu(previousMenu);
    },
  };
}
