import type { DesktopApi } from '../shared/api';

declare global {
  interface Window {
    gogAchievements?: DesktopApi;
  }
}

export async function getDesktopApi(): Promise<DesktopApi> {
  if (window.gogAchievements) return window.gogAchievements;
  const isElectron = navigator.userAgent.includes('Electron');
  if (!isElectron && new URLSearchParams(location.search).get('demo') === '1') {
    const { createDemoApi } = await import('../shared/demo-api');
    return createDemoApi({ storage: window.localStorage });
  }
  throw new Error(
    'The desktop bridge is unavailable. Open the installed app, or use the explicit browser demo.',
  );
}
