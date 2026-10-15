import type { CliRunner } from '../../src/main/cli-client';
import type { QueueStore } from '../../src/main/queue-store';
import type { ProcessProbe } from '../../src/main/process-identity';
import { OperationCoordinator } from '../../src/main/application/operation-coordinator';
import { SessionService } from '../../src/main/features/account/session.service';
import { LibraryService } from '../../src/main/features/library/library.service';
import { QueueService } from '../../src/main/features/queue/queue.service';
import { ApplyService } from '../../src/main/features/apply/apply.service';
import { PreviewStore } from '../../src/main/application/preview-store';
import { HistoryService } from '../../src/main/features/history/history.service';
import { RecoveryService } from '../../src/main/features/recovery/recovery.service';
import { WorkspaceService } from '../../src/main/workspace.service';

export function createWorkspace(
  cli: CliRunner,
  store: QueueStore,
  version: string,
  cliVersion: string,
  probe: ProcessProbe,
): WorkspaceService {
  const operations = new OperationCoordinator();
  const previews = new PreviewStore();
  const versions = { app: version, cli: cliVersion };
  const session = new SessionService(cli, previews, versions);
  const library = new LibraryService(cli, session, previews);
  const queues = new QueueService(cli, store, session, previews);
  const changes = new ApplyService(cli, store, probe, operations, session, queues, previews);
  const records = new HistoryService(store, session);
  const recovery = new RecoveryService(store, probe, operations);
  return new WorkspaceService(
    operations,
    recovery,
    session,
    library,
    queues,
    changes,
    records,
    versions,
  );
}
