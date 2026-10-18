import { Inject, Injectable } from '@nestjs/common';
import type { IpcMainInvokeEvent, BrowserWindow } from 'electron';
import type { z } from 'zod';
import type { ApiMethod } from '../shared/api';
import type { IpcData, IpcPayload, IpcResponse } from '../shared/ipc-contract';
import { ipcSchemas } from '../shared/schemas';
import { publicError, DesktopError } from './errors';
import { DESKTOP_WINDOW } from './ipc.tokens';

// Every API method needs a validator whose parsed output matches its payload.
const requestSchemas: { [Method in ApiMethod]: z.ZodType<IpcPayload<Method>> } = ipcSchemas;

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

  async execute<Method extends ApiMethod>(
    event: IpcMainInvokeEvent,
    method: Method,
    payload: unknown,
    action: (input: IpcPayload<NoInfer<Method>>) => Promise<IpcData<NoInfer<Method>>>,
  ): Promise<IpcResponse<Method>> {
    try {
      // Standalone Nest providers do not run the HTTP guard/pipe pipeline.
      if (!trustedSender(event, this.window))
        throw new DesktopError('IPC_DENIED', 'This request is not allowed.');
      const parsed = requestSchemas[method].safeParse(payload);
      if (!parsed.success)
        throw new DesktopError('INVALID_INPUT', 'Check the selected IDs and date values.');
      return { ok: true, data: await action(parsed.data) };
    } catch (error) {
      // Electron only preserves Error.message reliably. Keep codes in plain data.
      return { ok: false, error: publicError(error) };
    }
  }
}
