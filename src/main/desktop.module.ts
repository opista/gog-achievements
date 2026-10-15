import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import type { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { DesktopApi } from '../shared/api';
import { createDemoApi } from '../shared/demo-api';
import { CliClient, resolveCli, type CliRunner } from './cli-client';
import { DesktopError } from './errors';
import { IpcBoundary } from './ipc';
import { APP_ACTIONS, CLI_RUNNER, DESKTOP_WINDOW, WORKSPACE_API } from './ipc.tokens';
import { OperationManager } from './operation-manager';
import { QueueStore } from './queue-store';
import { RecoveryLifecycle } from './recovery-lifecycle';
import { WorkspaceController } from './workspace.controller';

export interface DesktopOptions {
  window: BrowserWindow;
  appActions: Pick<DesktopApi, 'checkForUpdates'>;
  demo: boolean;
  version: string;
  userDataPath: string;
  cli: Parameters<typeof resolveCli>[0];
}

@Module({ providers: [WorkspaceController, IpcBoundary, RecoveryLifecycle] })
export class DesktopModule {
  static register(options: DesktopOptions): DynamicModule {
    const workspaceProviders: Provider[] = options.demo
      ? [{ provide: WORKSPACE_API, useFactory: () => createDemoApi() }]
      : [
          {
            provide: CLI_RUNNER,
            useFactory: async (): Promise<CliRunner> => {
              try {
                // Use only the verified bundled path. Never fall back to PATH.
                return new CliClient(await resolveCli(options.cli));
              } catch {
                return {
                  run: async () => {
                    throw new DesktopError(
                      'CLI_PACKAGE_INVALID',
                      'The bundled CLI is missing or does not match this app. Reinstall the app.',
                    );
                  },
                };
              }
            },
          },
          {
            provide: QueueStore,
            useFactory: () => new QueueStore(join(options.userDataPath, 'queues')),
          },
          {
            provide: OperationManager,
            inject: [CLI_RUNNER, QueueStore],
            useFactory: (cli: CliRunner, store: QueueStore) =>
              new OperationManager(cli, store, options.version),
          },
          { provide: WORKSPACE_API, useExisting: OperationManager },
        ];
    return {
      module: DesktopModule,
      providers: [
        { provide: DESKTOP_WINDOW, useValue: options.window },
        { provide: APP_ACTIONS, useValue: options.appActions },
        ...workspaceProviders,
      ],
    };
  }
}
