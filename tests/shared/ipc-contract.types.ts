import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { IpcBoundary } from '../../src/main/ipc';
import type { WorkspaceController } from '../../src/main/workspace.controller';
import type { ApiMethod, IpcResult } from '../../src/shared/api';
import type { IpcData, IpcPayload } from '../../src/shared/ipc-contract';
import type { IpcApi } from '../../src/shared/ipc.generated';
import type { ipcSchemas } from '../../src/shared/schemas';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type SchemaPayloads = {
  [Method in ApiMethod]: Equal<z.output<(typeof ipcSchemas)[Method]>, IpcPayload<Method>>;
};
type BridgePayloads = {
  [Method in ApiMethod]: Equal<Parameters<IpcApi['workspace'][Method]>[0], IpcPayload<Method>>;
};
type BridgeResults = {
  [Method in ApiMethod]: Equal<
    Awaited<ReturnType<IpcApi['workspace'][Method]>>,
    IpcResult<IpcData<Method>>
  >;
};

// The generated bridge is part of the contract, including no-payload methods.
export type IpcContractChecks = [
  Assert<Equal<keyof typeof ipcSchemas, ApiMethod>>,
  Assert<Equal<keyof WorkspaceController, ApiMethod>>,
  Assert<Equal<keyof IpcApi['workspace'], ApiMethod>>,
  Assert<SchemaPayloads[ApiMethod]>,
  Assert<BridgePayloads[ApiMethod]>,
  Assert<BridgeResults[ApiMethod]>,
];

// Typechecked, never run: method inference must not widen to accept a handler
// with the wrong payload or result. Raw caller input deliberately stays unknown.
export function checkHandlerTypes(boundary: IpcBoundary, event: IpcMainInvokeEvent) {
  void boundary.execute(event, 'history', { gameId: '1' }, async (input) => {
    const game: string | undefined = input.gameId;
    void game;
    return [];
  });
  void boundary.execute(event, 'setCliActivationBlocked', { blocked: true }, async (input) => {
    const blocked: boolean = input.blocked;
    void blocked;
  });
  // @ts-expect-error apply needs a reviewed token, not a game ID handler.
  void boundary.execute(event, 'apply', {}, async (_input: { gameId: string }) => ({
    operationId: '1',
    state: 'unknown',
    report: null,
  }));
  // @ts-expect-error a history handler must return operation records.
  void boundary.execute(event, 'history', {}, async () => ({ authenticated: false }));
  // @ts-expect-error login has no payload for a handler to read.
  void boundary.execute(event, 'login', undefined, async (_input: { gameId: string }) => ({
    authenticated: false,
  }));
}
