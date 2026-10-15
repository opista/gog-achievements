import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { RecoveryService } from './recovery.service';

@Injectable()
export class RecoveryLifecycle implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(@Inject(RecoveryService) private readonly recovery: RecoveryService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.recovery.refresh().catch(() => {});
    }, 3000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
