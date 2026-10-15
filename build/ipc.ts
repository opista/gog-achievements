import { resolve } from 'node:path';
import type { PluginOptions } from '@electron-ipc-bridge/vite-plugin';

export const ipcBridgeOptions = {
  main: resolve('src/main/application.ts'),
  preload: resolve('src/preload/index.ts'),
  types: {
    runtime: resolve('src/shared/ipc.generated.ts'),
    global: resolve('src/preload/ipc.generated.d.ts'),
  },
} satisfies PluginOptions;
