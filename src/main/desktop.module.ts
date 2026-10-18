import { Module, type DynamicModule } from '@nestjs/common';
import type { BrowserWindow } from 'electron';
import type { DesktopApi, AppUpdateActions } from '../shared/api';
import { disabledCliUpdates } from '../shared/cli-updates';
import { CLI_VERSION } from '../shared/cli-release';
import type { CliSelection } from './cli-updates/manager';
import type { CliRuntime } from './application/cli-runtime';
import { createDemoApi } from '../shared/demo-api';
import { CliClient, resolveCli, type CliRunner } from './cli-client';
import { DesktopError } from './errors';
import { IpcBoundary } from './ipc';
import { APP_ACTIONS, DESKTOP_WINDOW, WORKSPACE_API } from './ipc.tokens';
import { WorkspaceModule } from './workspace.module';
import { WorkspaceController } from './workspace.controller';
import type { ExportDestination } from './workspace.tokens';

export interface DesktopOptions {
  window: BrowserWindow;
  appActions: Pick<DesktopApi, 'checkForUpdates'> &
    Partial<Omit<AppUpdateActions, 'checkForUpdates'>>;
  demo: boolean;
  version: string;
  userDataPath: string;
  chooseExportFile?: ExportDestination;
  cli: Parameters<typeof resolveCli>[0];
  cliSelection?: CliSelection;
  createCli?: () => CliRunner | Promise<CliRunner>;
  createReplacementCli?: CliRuntime['create'];
}

@Module({ providers: [WorkspaceController, IpcBoundary] })
export class DesktopModule {
  static register(options: DesktopOptions): DynamicModule {
    return {
      module: DesktopModule,
      imports: options.demo
        ? []
        : [
            WorkspaceModule.register({
              version: options.version,
              cliVersion: options.cliSelection?.version,
              userDataPath: options.userDataPath,
              chooseExportFile: options.chooseExportFile,
              createReplacementCli: options.createReplacementCli,
              createCli:
                options.createCli ??
                (async (): Promise<CliRunner> => {
                  try {
                    // The initial selection is verified before the renderer starts. Never use PATH.
                    return new CliClient(
                      options.cliSelection?.executable ?? (await resolveCli(options.cli)),
                    );
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
                }),
            }),
          ],
      providers: [
        { provide: DESKTOP_WINDOW, useValue: options.window },
        {
          provide: APP_ACTIONS,
          useValue: {
            getCliUpdateState: async () =>
              disabledCliUpdates(options.cliSelection?.version ?? CLI_VERSION),
            setCliActivationBlocked: async () => {},
            ...options.appActions,
          } satisfies AppUpdateActions,
        },
        ...(options.demo ? [{ provide: WORKSPACE_API, useFactory: () => createDemoApi() }] : []),
      ],
    };
  }
}
