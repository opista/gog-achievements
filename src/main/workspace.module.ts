import { Module, type DynamicModule } from '@nestjs/common';
import { join } from 'node:path';
import type { CliRunner } from './cli-client';
import { CLI_VERSION } from '../shared/cli-release';
import { WORKSPACE_API } from './ipc.tokens';
import {
  CLI_RUNNER,
  PROCESS_PROBE,
  WORKSPACE_VERSIONS,
  EXPORT_DESTINATION,
  type ExportDestination,
} from './workspace.tokens';
import { QueueStore } from './queue-store';
import { NativeProcessProbe, type ProcessProbe } from './process-identity';
import { OperationCoordinator } from './application/operation-coordinator';
import { SessionService } from './features/account/session.service';
import { ApplyService } from './features/apply/apply.service';
import { PreviewStore } from './application/preview-store';
import { LibraryService } from './features/library/library.service';
import { QueueService } from './features/queue/queue.service';
import { HistoryService } from './features/history/history.service';
import { RecoveryService } from './features/recovery/recovery.service';
import { RecoveryLifecycle } from './features/recovery/recovery-lifecycle';
import { WorkspaceService } from './workspace.service';

interface WorkspaceOptions {
  createCli(): CliRunner | Promise<CliRunner>;
  userDataPath: string;
  version: string;
  cliVersion?: string;
  probe?: ProcessProbe;
  chooseExportFile?: ExportDestination;
}

@Module({
  providers: [
    OperationCoordinator,
    SessionService,
    LibraryService,
    QueueService,
    ApplyService,
    PreviewStore,
    HistoryService,
    RecoveryService,
    RecoveryLifecycle,
    WorkspaceService,
    { provide: WORKSPACE_API, useExisting: WorkspaceService },
  ],
  exports: [WORKSPACE_API],
})
export class WorkspaceModule {
  static register(options: WorkspaceOptions): DynamicModule {
    return {
      module: WorkspaceModule,
      providers: [
        { provide: CLI_RUNNER, useFactory: options.createCli },
        { provide: EXPORT_DESTINATION, useValue: options.chooseExportFile ?? (async () => null) },
        {
          provide: QueueStore,
          useFactory: () => new QueueStore(join(options.userDataPath, 'queues')),
        },
        { provide: PROCESS_PROBE, useFactory: () => options.probe ?? new NativeProcessProbe() },
        {
          provide: WORKSPACE_VERSIONS,
          useValue: { app: options.version, cli: options.cliVersion ?? CLI_VERSION },
        },
      ],
    };
  }
}
