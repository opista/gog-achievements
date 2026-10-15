import type { DesktopApi, DesktopPlatform } from '../shared/api';
import { createDesktopApi } from './platform/desktop-api';

declare global {
  interface Window {
    gogPlatform?: DesktopPlatform;
  }
}

export async function getDesktopApi(): Promise<DesktopApi> {
  if (window.gogPlatform) {
    await window.gogPlatform.ready();
    if (window.ipc?.workspace) return createDesktopApi(window.ipc, window.gogPlatform);
    throw new Error('The desktop bridge could not load. Restart the app.');
  }
  const isElectron = navigator.userAgent.includes('Electron');
  if (!isElectron && new URLSearchParams(location.search).get('demo') === '1') {
    const { createDemoApi } = await import('../shared/demo-api');
    return createDemoApi({ storage: window.localStorage });
  }
  throw new Error(
    'The desktop bridge is unavailable. Open the installed app, or use the explicit browser demo.',
  );
}
