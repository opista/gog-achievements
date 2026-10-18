import { Injectable } from '@nestjs/common';
import type { Queue, Report } from '../../shared/api';
import { DesktopError } from '../errors';
export interface Preview {
  token: string;
  path: string;
  draft: string;
  digest: string;
  queue: Queue;
  report: Report;
}

@Injectable()
export class PreviewStore {
  private previews = new Map<string, Preview>();
  clear(): void {
    this.previews.clear();
  }
  get pending(): boolean {
    return this.previews.size > 0;
  }
  discard(token: string): void {
    this.previews.delete(token);
  }
  save(preview: Preview): void {
    this.previews.set(preview.token, preview);
  }
  consume(token: string): Preview {
    const preview = this.previews.get(token);
    if (!preview)
      throw new DesktopError('STALE_PREVIEW', 'Select Apply changes to review your queue again.');
    this.previews.delete(token);
    return preview;
  }
}
