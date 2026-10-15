import { Inject, Injectable } from '@nestjs/common';
import type { IpcMainInvokeEvent, BrowserWindow } from 'electron';
import type { ApiMethod, IpcResult } from '../shared/api';
import { ipcSchemas } from '../shared/schemas';
import { publicError, DesktopError } from './errors';
import { DESKTOP_WINDOW } from './ipc.tokens';

export function trustedSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  window: BrowserWindow,
): boolean {
  return (
    event.sender === window.webContents &&
    event.senderFrame !== null &&
    event.senderFrame === window.webContents.mainFrame
  );
}
@Injectable()
export class IpcBoundary {
  constructor(@Inject(DESKTOP_WINDOW) private readonly window: BrowserWindow) {}

  async execute<T>(
    event: IpcMainInvokeEvent,
    method: ApiMethod,
    payload: unknown,
    action: () => Promise<T>,
  ): Promise<IpcResult<T>> {
    try {
      // Standalone Nest providers do not run the HTTP guard/pipe pipeline.
      if (!trustedSender(event, this.window))
        throw new DesktopError('IPC_DENIED', 'This request is not allowed.');
      if (!ipcSchemas[method].safeParse(payload).success)
        throw new DesktopError('INVALID_INPUT', 'Check the selected IDs and date values.');
      return { ok: true, data: await action() };
    } catch (error) {
      // Electron only preserves Error.message reliably. Keep codes in plain data.
      return { ok: false, error: publicError(error) };
    }
  }
}
