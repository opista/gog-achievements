import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { OperationManager } from './operation-manager';

@Injectable()
export class RecoveryLifecycle implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(@Optional() @Inject(OperationManager) private readonly manager?: OperationManager) {}

  onModuleInit(): void {
    if (!this.manager) return;
    this.timer = setInterval(() => {
      void this.manager?.refreshRecovery().catch(() => {});
    }, 3000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
