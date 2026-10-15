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
