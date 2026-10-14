import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { uiSecurity } from './build/ui-security';

export default defineConfig(({ command }) => {
  const security = uiSecurity(command);
  return {
    root: resolve('src/renderer'),
    base: './',
    publicDir: resolve('resources/ui'),
    html: security.html,
    plugins: [react(), security.plugin],
    server: { host: '0.0.0.0', port: 5173, strictPort: true },
    build: { outDir: resolve('dist-web'), emptyOutDir: true },
  };
});
