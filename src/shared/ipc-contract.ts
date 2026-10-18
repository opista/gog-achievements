// Import queries keep these aliases self-contained when the bridge generator
// copies them into ipc.generated.ts beside this module. DTOs stay in api.ts.
export type IpcPayload<Method extends import('./api').ApiMethod> = Parameters<
  import('./api').DesktopApi[Method]
>[0];

export type IpcData<Method extends import('./api').ApiMethod> = Awaited<
  ReturnType<import('./api').DesktopApi[Method]>
>;

export type IpcResponse<Method extends import('./api').ApiMethod> = import('./api').IpcResult<
  IpcData<Method>
>;
