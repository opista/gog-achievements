import { randomBytes } from 'node:crypto';
import type { Plugin } from 'vite';

export function uiSecurity(command: string): { html: { cspNonce?: string }; plugin: Plugin } {
  const development = command === 'serve';
  const nonce = development ? randomBytes(18).toString('base64') : undefined;
  return {
    html: nonce ? { cspNonce: nonce } : {},
    plugin: {
      name: 'gog-ui-security',
      transformIndexHtml(html) {
        return html
          .replace(
            /script-src [^;]+/,
            development ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'",
          )
          .replace(
            /connect-src [^;]+/,
            development ? "connect-src 'self' ws: wss:" : "connect-src 'none'",
          );
      },
    },
  };
}
