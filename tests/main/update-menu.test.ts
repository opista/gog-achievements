import { expect, test, vi } from 'vitest';
import type {
  BaseWindow,
  BrowserWindow,
  KeyboardEvent,
  Dialog,
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
  MessageBoxOptions,
  MessageBoxReturnValue,
} from 'electron';
import { installUpdates } from '../../src/main/update-menu';
import type { UpdateCheck } from '../../src/main/update-service';
import type { CliUpdateState } from '../../src/shared/cli-updates';

const available: UpdateCheck = {
  status: 'available',
  currentVersion: '0.1.0',
  latestVersion: '0.2.0',
  downloadUrl: 'https://github.com/metacurb/gog-achievements/releases/download/v0.2.0/app.dmg',
  releaseUrl: 'https://github.com/metacurb/gog-achievements/releases/tag/v0.2.0',
  message: 'You have version 0.1.0.',
};

const builtItems = new WeakSet<MenuItem>();
function menuFrom(template: (MenuItemConstructorOptions | MenuItem)[]): Menu {
  return {
    items: template.map((item) => {
      if (builtItems.has(item as MenuItem)) return item;
      const constructed = {
        ...item,
        submenu: Array.isArray(item.submenu) ? menuFrom(item.submenu) : item.submenu,
      } as MenuItem;
      const onClick = item.click as MenuItemConstructorOptions['click'];
      constructed.click = (event: KeyboardEvent, window?: BaseWindow) =>
        onClick?.(constructed, window, event);
      builtItems.add(constructed);
      return constructed;
    }),
  } as unknown as Menu;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function fixture({
  packaged = true,
  platform = 'darwin' as NodeJS.Platform,
  result = available,
  existing = null as Menu | null,
  busy = false,
  request = undefined as (() => Promise<UpdateCheck>) | undefined,
  cliUpdates = undefined as { check(): Promise<CliUpdateState> } | undefined,
} = {}) {
  let applicationMenu = existing;
  let active = busy;
  const check = vi.fn(request ?? (async () => result));
  const openDownload = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  const showMessageBox = vi.fn().mockResolvedValue({ response: 1, checkboxChecked: false });
  const window = { isDestroyed: vi.fn(() => false) } as unknown as BrowserWindow;
  const shell = { openExternal: vi.fn().mockResolvedValue(undefined) };
  const MenuApi = {
    getApplicationMenu: vi.fn(() => applicationMenu),
    buildFromTemplate: vi.fn(menuFrom),
    setApplicationMenu: vi.fn((menu: Menu | null) => {
      applicationMenu = menu;
    }),
  };
  const updates = installUpdates({
    app: { isPackaged: packaged, getVersion: () => '0.1.0' },
    dialog: { showMessageBox } as unknown as Pick<Dialog, 'showMessageBox'>,
    Menu: MenuApi,
    shell,
    getWindow: () => window,
    isBusy: () => active,
    repository: 'metacurb/gog-achievements',
    platform,
    architecture: 'arm64',
    service: { check, openDownload },
    cliUpdates,
  });
  const notices = () => showMessageBox.mock.calls.map((args) => args.at(-1) as MessageBoxOptions);
  const updateItem = () => {
    const find = (menu: Menu): Menu['items'][number] | undefined => {
      for (const item of menu.items) {
        if (item.id === 'check-for-updates') return item;
        const child = item.submenu && find(item.submenu);
        if (child) return child;
      }
    };
    return applicationMenu && find(applicationMenu);
  };
  return {
    updates,
    check,
    openDownload,
    showMessageBox,
    notices,
    window,
    shell,
    MenuApi,
    menu: () => applicationMenu,
    updateItem,
    setBusy: (value: boolean) => {
      active = value;
    },
  };
}

test('the macOS app menu keeps standard roles and adds Check for Updates after About', () => {
  const f = fixture({ packaged: false });
  const items = f.menu()!.items;
  expect(items.map((item) => item.role)).toEqual([
    'appMenu',
    'fileMenu',
    'editMenu',
    'viewMenu',
    'windowMenu',
    'help',
  ]);
  expect(items[0]!.submenu!.items.map((item) => item.role ?? item.id ?? item.type)).toEqual([
    'about',
    'check-for-updates',
    'separator',
    'services',
    'separator',
    'hide',
    'hideOthers',
    'unhide',
    'separator',
    'quit',
  ]);
  expect(f.updateItem()?.label).toBe('Check for Updates…');
  expect(f.check).not.toHaveBeenCalled();
  f.updates.cleanup();
});

test('Windows keeps existing menus, callbacks and accelerators and adds the Help action', () => {
  const save = vi.fn();
  const help = vi.fn();
  const original = menuFrom([
    {
      label: '&File',
      submenu: [{ id: 'save', label: 'Save', accelerator: 'Ctrl+S', click: save }],
    },
    { role: 'editMenu' },
    { label: '&Help', submenu: [{ id: 'docs', label: 'Documentation', click: help }] },
  ]);
  const f = fixture({ platform: 'win32', packaged: false, existing: original });
  const items = f.menu()!.items;
  expect(items.map((item) => item.label ?? item.role)).toEqual(['&File', 'editMenu', '&Help']);
  const saveItem = items[0]!.submenu!.items[0]!;
  expect(saveItem.accelerator).toBe('Ctrl+S');
  expect(saveItem).toBe(original.items[0]!.submenu!.items[0]);
  expect(items[1]).toBe(original.items[1]);
  const event = { control: true } as KeyboardEvent;
  saveItem.click(event, f.window);
  expect(save).toHaveBeenCalledExactlyOnceWith(saveItem, f.window, event);
  const helpItems = items[2]!.submenu!.items;
  expect(helpItems.map((item) => item.id ?? item.type)).toEqual([
    'docs',
    'separator',
    'check-for-updates',
  ]);
  expect(helpItems[0]).toBe(original.items[2]!.submenu!.items[0]);
  helpItems[0]!.click();
  expect(help).toHaveBeenCalledOnce();
  f.updates.cleanup();
  expect(f.menu()).toBe(original);
});

test('an existing macOS app menu keeps its custom actions and has only one update item', () => {
  const original = menuFrom([
    {
      label: 'GOG Achievements',
      submenu: [
        { role: 'about' },
        { id: 'check-for-updates', label: 'Old update action' },
        { id: 'preferences', label: 'Settings…', accelerator: 'Cmd+,' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
  ]);
  const f = fixture({ packaged: false, existing: original });
  const items = f.menu()!.items[0]!.submenu!.items;
  expect(items.map((item) => item.role ?? item.id)).toEqual([
    'about',
    'check-for-updates',
    'preferences',
    'quit',
  ]);
  expect(items[2]!.accelerator).toBe('Cmd+,');
  f.updates.cleanup();
});

test('a packaged startup checks once and Download uses only the retained service URL', async () => {
  const f = fixture();
  f.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false });
  await settle();
  expect(f.check).toHaveBeenCalledOnce();
  expect(f.showMessageBox.mock.calls[0]?.[0]).toBe(f.window);
  expect(f.notices()[0]).toMatchObject({
    title: 'Update available',
    message: 'GOG Achievements 0.2.0 is available.',
    buttons: ['Download', 'Later'],
    detail: 'Download the new version in your browser, then open it to install.',
    cancelId: 1,
  });
  expect(f.openDownload).toHaveBeenCalledExactlyOnceWith();
  expect(f.shell.openExternal).not.toHaveBeenCalled();
  f.updates.onIdle();
  f.updates.onIdle();
  await settle();
  expect(f.showMessageBox).toHaveBeenCalledOnce();
  f.updates.cleanup();
});

test('a manual check reports both app status and the pending CLI without forcing a restart', async () => {
  const cliCheck = vi.fn(async (): Promise<CliUpdateState> => ({
    supported: true,
    currentVersion: '0.5.1',
    bundledVersion: '0.5.1',
    status: 'ready',
    pendingVersion: '0.6.0',
    message: 'CLI 0.6.0 is ready. It will be used next time you open the app.',
  }));
  const f = fixture({
    result: { status: 'up-to-date', currentVersion: '0.1.0', message: 'The app is up to date.' },
    cliUpdates: { check: cliCheck },
  });
  await settle();
  expect(f.showMessageBox).not.toHaveBeenCalled();
  await f.updates.checkForUpdates();
  expect(cliCheck.mock.calls).toEqual([[], []]);
  expect(f.notices()[0]).toMatchObject({
    message: 'The app is up to date.',
    detail: expect.stringContaining('next time you open the app'),
    buttons: ['OK'],
  });
  expect(f.openDownload).not.toHaveBeenCalled();
  f.updates.cleanup();
});

test('a component check failure does not suppress an app update notice', async () => {
  const f = fixture({ cliUpdates: { check: vi.fn().mockRejectedValue(new Error('offline')) } });
  await settle();
  expect(f.notices()[0]?.message).toBe('GOG Achievements 0.2.0 is available.');
  f.updates.cleanup();
});

test('Later leaves the browser closed and a later manual check can show the update again', async () => {
  const f = fixture();
  await settle();
  expect(f.openDownload).not.toHaveBeenCalled();
  await f.updates.checkForUpdates();
  expect(f.check).toHaveBeenCalledTimes(2);
  expect(f.showMessageBox).toHaveBeenCalledTimes(2);
  expect(f.openDownload).not.toHaveBeenCalled();
  f.updates.cleanup();
});

for (const status of ['up-to-date', 'no-release', 'unavailable', 'unsupported-target'] as const) {
  test(`startup is silent for ${status} and a manual check explains the result`, async () => {
    const result: UpdateCheck = { status, currentVersion: '0.1.0', message: `Result: ${status}.` };
    const f = fixture({ result });
    await settle();
    expect(f.check).toHaveBeenCalledOnce();
    expect(f.showMessageBox).not.toHaveBeenCalled();
    await f.updates.checkForUpdates();
    expect(f.notices()).toHaveLength(1);
    expect(f.notices()[0]?.message).toBe(result.message);
    expect(f.notices()[0]?.type).toBe(
      ['unavailable', 'no-release'].includes(status) ? 'warning' : 'info',
    );
    expect(f.openDownload).not.toHaveBeenCalled();
    f.updates.cleanup();
  });
}

test('development does not check remotely and its native menu explains installed builds', async () => {
  const f = fixture({ packaged: false });
  expect(f.check).not.toHaveBeenCalled();
  f.updateItem()!.click();
  await settle();
  expect(f.check).not.toHaveBeenCalled();
  expect(f.notices()[0]).toMatchObject({
    message: 'Update checks are available in the installed app.',
    buttons: ['OK'],
  });
  expect(f.openDownload).not.toHaveBeenCalled();
  f.updates.cleanup();
});

test('manual checks during a startup request share one check and request a visible result', async () => {
  const waiting = deferred<UpdateCheck>();
  const f = fixture({ request: () => waiting.promise });
  const first = f.updates.checkForUpdates();
  const second = f.updates.checkForUpdates();
  expect(first).toBe(second);
  waiting.resolve({
    status: 'up-to-date',
    currentVersion: '0.1.0',
    message: 'You are up to date.',
  });
  await first;
  expect(f.check).toHaveBeenCalledOnce();
  expect(f.showMessageBox).toHaveBeenCalledOnce();
  f.updates.cleanup();
});

test('startup notices wait for the CLI and repeated idle events show only one dialog', async () => {
  const f = fixture({ busy: true });
  await settle();
  expect(f.check).toHaveBeenCalledOnce();
  expect(f.showMessageBox).not.toHaveBeenCalled();
  f.updates.onIdle();
  expect(f.showMessageBox).not.toHaveBeenCalled();
  await f.updates.checkForUpdates();
  expect(f.check).toHaveBeenCalledOnce();
  f.setBusy(false);
  f.updates.onIdle();
  f.updates.onIdle();
  await settle();
  expect(f.showMessageBox).toHaveBeenCalledOnce();
  expect(f.openDownload).not.toHaveBeenCalled();
  f.updates.cleanup();
});

test('checks while a notice is open do not start another request or another dialog', async () => {
  const answer = deferred<MessageBoxReturnValue>();
  const f = fixture();
  f.showMessageBox.mockReturnValueOnce(answer.promise);
  await settle();
  const first = f.updates.checkForUpdates();
  const second = f.updates.checkForUpdates();
  expect(first).toBe(second);
  expect(f.check).toHaveBeenCalledOnce();
  expect(f.showMessageBox).toHaveBeenCalledOnce();
  answer.resolve({ response: 1, checkboxChecked: false });
  await first;
  f.updates.cleanup();
});

test('cleanup discards a deferred notice and disables old menu callbacks and public actions', async () => {
  const f = fixture({ busy: true });
  const oldItem = f.updateItem()!;
  await settle();
  f.updates.cleanup();
  f.updates.cleanup();
  f.setBusy(false);
  f.updates.onIdle();
  oldItem.click();
  await f.updates.checkForUpdates();
  expect(f.showMessageBox).not.toHaveBeenCalled();
  expect(f.check).toHaveBeenCalledOnce();
  expect(f.menu()).toBeNull();
});

test('cleanup aborts an open dialog and ignores its late Download response', async () => {
  const answer = deferred<MessageBoxReturnValue>();
  const f = fixture();
  f.showMessageBox.mockReturnValueOnce(answer.promise);
  await settle();
  const signal = f.notices()[0]!.signal!;
  expect(signal.aborted).toBe(false);
  f.updates.cleanup();
  expect(signal.aborted).toBe(true);
  answer.resolve({ response: 0, checkboxChecked: false });
  await settle();
  expect(f.openDownload).not.toHaveBeenCalled();
  expect(f.showMessageBox).toHaveBeenCalledOnce();
});

test('cleanup preserves a replacement application menu installed by other code', async () => {
  const f = fixture({ packaged: false });
  const replacement = menuFrom([{ role: 'editMenu' }]);
  f.MenuApi.setApplicationMenu(replacement);
  f.updates.cleanup();
  expect(f.menu()).toBe(replacement);
});

test('a failed download shows one clear failure without accepting a URL from the dialog', async () => {
  const f = fixture();
  f.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false });
  f.openDownload.mockResolvedValueOnce(false);
  await settle();
  expect(f.openDownload).toHaveBeenCalledExactlyOnceWith();
  expect(f.notices()).toHaveLength(2);
  expect(f.notices()[1]?.message).toBe('The download could not open in your browser.');
  f.updates.cleanup();
});

test('a failed native dialog is contained and the manual command remains usable', async () => {
  const f = fixture();
  f.showMessageBox.mockRejectedValueOnce(new Error('native dialog closed'));
  await settle();
  await f.updates.checkForUpdates();
  expect(f.showMessageBox).toHaveBeenCalledTimes(2);
  f.updates.cleanup();
});

test('cleanup ignores a late startup response and prevents any further check', async () => {
  const waiting = deferred<UpdateCheck>();
  const f = fixture({ request: () => waiting.promise });
  f.updates.cleanup();
  waiting.resolve(available);
  await settle();
  await f.updates.checkForUpdates();
  expect(f.check).toHaveBeenCalledOnce();
  expect(f.showMessageBox).not.toHaveBeenCalled();
  expect(f.openDownload).not.toHaveBeenCalled();
});

test('unexpected check failures stay silent at startup and show safe manual feedback', async () => {
  const f = fixture({
    request: async () => {
      throw new Error('private request details');
    },
  });
  await settle();
  expect(f.showMessageBox).not.toHaveBeenCalled();
  await f.updates.checkForUpdates();
  expect(f.notices()[0]?.message).toBe('Could not check for updates. Please try again later.');
  expect(JSON.stringify(f.notices())).not.toContain('private request details');
  f.updates.cleanup();
});

test('a destroyed parent window is not passed to the native dialog', async () => {
  const f = fixture();
  vi.mocked(f.window.isDestroyed).mockReturnValue(true);
  await settle();
  expect(f.showMessageBox.mock.calls[0]).toHaveLength(1);
  expect(f.notices()[0]?.title).toBe('Update available');
  f.updates.cleanup();
});

test('the default Windows menu retains File, Edit, View and Window beside Help', () => {
  const f = fixture({ packaged: false, platform: 'win32' });
  expect(f.menu()!.items.map((item) => item.role)).toEqual([
    'fileMenu',
    'editMenu',
    'viewMenu',
    'windowMenu',
    'help',
  ]);
  expect(f.menu()!.items.at(-1)!.submenu!.items[0]!.id).toBe('check-for-updates');
  f.updates.cleanup();
});

test.each(['win32', 'darwin'] as const)(
  'the packaged %s menu replaces Electron defaults and keeps only display controls in View',
  (platform) => {
    const original = menuFrom([
      { role: 'viewMenu', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
    ]);
    const f = fixture({ platform, existing: original });
    const view = f.menu()!.items.find((item) => item.role === 'viewMenu')!;
    expect(view).not.toBe(original.items[0]);
    expect(view.submenu!.items.map((item) => item.role ?? item.type)).toEqual([
      'resetZoom',
      'zoomIn',
      'zoomOut',
      'separator',
      'togglefullscreen',
    ]);
    expect(f.updateItem()?.label).toBe('Check for Updates…');
    f.updates.cleanup();
    expect(f.menu()).toBe(original);
  },
);
