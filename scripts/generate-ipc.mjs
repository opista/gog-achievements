import { electronIpcBridge } from '@electron-ipc-bridge/vite-plugin';
import { build, createLogger } from 'vite';
import { ipcBridgeOptions } from '../build/ipc.ts';

// Run the public Vite plugin without compiling the desktop app or writing a bundle.
const entry = 'virtual:ipc-types';
const logger = createLogger('warn');
const logError = logger.error.bind(logger);
let failed = false;
logger.error = (message, options) => {
  failed = true;
  logError(message, options);
};
await build({
  configFile: false,
  customLogger: logger,
  plugins: [
    electronIpcBridge(ipcBridgeOptions),
    {
      name: 'ipc-types-entry',
      resolveId: (id) => (id === entry ? entry : undefined),
      load: (id) => (id === entry ? 'export {};' : undefined),
    },
  ],
  build: {
    write: false,
    emptyOutDir: false,
    rollupOptions: {
      input: entry,
      onLog(level, log, report) {
        if (log.code !== 'EMPTY_BUNDLE') report(level, log);
      },
    },
  },
});
if (failed) throw new Error('IPC type generation failed.');
