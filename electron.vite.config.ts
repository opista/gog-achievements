import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { uiSecurity } from './build/ui-security';
import { electronIpcBridge } from '@electron-ipc-bridge/vite-plugin';
import { ipcBridgeOptions } from './build/ipc';

export default defineConfig(({ command }) => {
  const security = uiSecurity(command);
  return {
    main: {
      plugins: [externalizeDepsPlugin(), electronIpcBridge(ipcBridgeOptions)],
      build: { rollupOptions: { input: resolve('src/main/index.ts') } },
    },
    preload: {
      plugins: [externalizeDepsPlugin({ exclude: ['@electron-ipc-bridge/core'] })],
      build: {
        rollupOptions: {
          input: resolve('src/preload/index.ts'),
          output: { format: 'cjs', entryFileNames: 'index.cjs' },
        },
      },
    },
    renderer: {
      root: resolve('src/renderer'),
      base: './',
      publicDir: resolve('resources/ui'),
      html: security.html,
      plugins: [react(), security.plugin],
      build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
      server: { host: '127.0.0.1', port: 5174, strictPort: true },
    },
  };
});
