import 'reflect-metadata';
import { createIpcApp, type Constructor } from '@electron-ipc-bridge/core';
import { NestFactory } from '@nestjs/core';
import type { WorkspaceApi } from '../shared/api';
import { DesktopModule, type DesktopOptions } from './desktop.module';
import { WORKSPACE_API } from './ipc.tokens';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import type { CliActivation } from './cli-updates/manager';

export interface DesktopApplication {
  readonly api: WorkspaceApi;
  activateCli(activation: CliActivation): Promise<boolean>;
  setCliActivationBlocked(input: { blocked: boolean }): Promise<void>;
  close(): Promise<void>;
}

export async function createDesktopApplication(
  options: DesktopOptions,
): Promise<DesktopApplication> {
  const context = await NestFactory.createApplicationContext(DesktopModule.register(options), {
    logger: false,
    abortOnError: false,
  });
  try {
    const ipc = createIpcApp({
      // Keep the exposed controllers statically visible to type generation.
      // Nest resolves constructor dependencies; the bridge declares unknown[] arguments.
      controllers: [WorkspaceController] as Constructor<WorkspaceController>[],
      resolver: { resolve: (token) => context.get(token) },
    });
    let closing: Promise<void> | undefined;
    const api = context.get<WorkspaceApi>(WORKSPACE_API);
    return {
      api,
      activateCli: (activation) =>
        api instanceof WorkspaceService ? api.activateCli(activation) : Promise.resolve(false),
      setCliActivationBlocked: (input) =>
        api instanceof WorkspaceService ? api.setCliActivationBlocked(input) : Promise.resolve(),
      close() {
        closing ??= (async () => {
          ipc.dispose();
          await context.close();
        })();
        return closing;
      },
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}
