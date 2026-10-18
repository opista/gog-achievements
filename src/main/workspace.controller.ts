import { IpcController, IpcHandle, RawEvent } from '@electron-ipc-bridge/core';
import { Inject, Injectable } from '@nestjs/common';
import type { IpcMainInvokeEvent } from 'electron';
import type { AppUpdateActions, WorkspaceApi } from '../shared/api';
import type { IpcPayload, IpcResponse } from '../shared/ipc-contract';
import { IpcBoundary } from './ipc';
import { APP_ACTIONS, WORKSPACE_API } from './ipc.tokens';

@Injectable()
@IpcController('workspace')
export class WorkspaceController {
  constructor(
    @Inject(WORKSPACE_API) private readonly api: WorkspaceApi,
    @Inject(APP_ACTIONS) private readonly appActions: AppUpdateActions,
    @Inject(IpcBoundary) private readonly boundary: IpcBoundary,
  ) {}

  @IpcHandle()
  initialize(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: IpcPayload<'initialize'>,
  ): Promise<IpcResponse<'initialize'>> {
    return this.boundary.execute(event, 'initialize', payload, () => this.api.initialize());
  }

  @IpcHandle()
  checkForUpdates(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: IpcPayload<'checkForUpdates'>,
  ): Promise<IpcResponse<'checkForUpdates'>> {
    return this.boundary.execute(event, 'checkForUpdates', payload, () =>
      this.appActions.checkForUpdates(),
    );
  }

  @IpcHandle()
  getCliUpdateState(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: IpcPayload<'getCliUpdateState'>,
  ): Promise<IpcResponse<'getCliUpdateState'>> {
    return this.boundary.execute(event, 'getCliUpdateState', payload, () =>
      this.appActions.getCliUpdateState(),
    );
  }

  @IpcHandle()
  setCliActivationBlocked(
    @RawEvent() event: IpcMainInvokeEvent,
    input: IpcPayload<'setCliActivationBlocked'>,
  ): Promise<IpcResponse<'setCliActivationBlocked'>> {
    return this.boundary.execute(event, 'setCliActivationBlocked', input, (parsed) =>
      this.appActions.setCliActivationBlocked(parsed),
    );
  }

  @IpcHandle()
  login(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: IpcPayload<'login'>,
  ): Promise<IpcResponse<'login'>> {
    return this.boundary.execute(event, 'login', payload, () => this.api.login());
  }

  @IpcHandle()
  logout(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: IpcPayload<'logout'>,
  ): Promise<IpcResponse<'logout'>> {
    return this.boundary.execute(event, 'logout', payload, () => this.api.logout());
  }

  @IpcHandle()
  listGames(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: IpcPayload<'listGames'>,
  ): Promise<IpcResponse<'listGames'>> {
    return this.boundary.execute(event, 'listGames', payload, () => this.api.listGames());
  }

  @IpcHandle()
  listAchievements(
    @RawEvent() event: IpcMainInvokeEvent,
    gameId: IpcPayload<'listAchievements'>,
  ): Promise<IpcResponse<'listAchievements'>> {
    return this.boundary.execute(event, 'listAchievements', gameId, (parsed) =>
      this.api.listAchievements(parsed),
    );
  }

  @IpcHandle()
  exportAchievements(
    @RawEvent() event: IpcMainInvokeEvent,
    input: IpcPayload<'exportAchievements'>,
  ): Promise<IpcResponse<'exportAchievements'>> {
    return this.boundary.execute(event, 'exportAchievements', input, (parsed) =>
      this.api.exportAchievements(parsed),
    );
  }

  @IpcHandle()
  getQueue(
    @RawEvent() event: IpcMainInvokeEvent,
    gameId: IpcPayload<'getQueue'>,
  ): Promise<IpcResponse<'getQueue'>> {
    return this.boundary.execute(event, 'getQueue', gameId, (parsed) => this.api.getQueue(parsed));
  }

  @IpcHandle()
  listQueues(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: IpcPayload<'listQueues'>,
  ): Promise<IpcResponse<'listQueues'>> {
    return this.boundary.execute(event, 'listQueues', payload, () => this.api.listQueues());
  }

  @IpcHandle()
  addAchievements(
    @RawEvent() event: IpcMainInvokeEvent,
    input: IpcPayload<'addAchievements'>,
  ): Promise<IpcResponse<'addAchievements'>> {
    return this.boundary.execute(event, 'addAchievements', input, (parsed) =>
      this.api.addAchievements(parsed),
    );
  }

  @IpcHandle()
  removeAchievements(
    @RawEvent() event: IpcMainInvokeEvent,
    input: IpcPayload<'removeAchievements'>,
  ): Promise<IpcResponse<'removeAchievements'>> {
    return this.boundary.execute(event, 'removeAchievements', input, (parsed) =>
      this.api.removeAchievements(parsed),
    );
  }

  @IpcHandle()
  setDates(
    @RawEvent() event: IpcMainInvokeEvent,
    input: IpcPayload<'setDates'>,
  ): Promise<IpcResponse<'setDates'>> {
    return this.boundary.execute(event, 'setDates', input, (parsed) => this.api.setDates(parsed));
  }

  @IpcHandle()
  preview(
    @RawEvent() event: IpcMainInvokeEvent,
    input: IpcPayload<'preview'>,
  ): Promise<IpcResponse<'preview'>> {
    return this.boundary.execute(event, 'preview', input, (parsed) => this.api.preview(parsed));
  }

  @IpcHandle()
  cancelPreview(
    @RawEvent() event: IpcMainInvokeEvent,
    input: IpcPayload<'cancelPreview'>,
  ): Promise<IpcResponse<'cancelPreview'>> {
    return this.boundary.execute(event, 'cancelPreview', input, (parsed) =>
      this.api.cancelPreview(parsed),
    );
  }

  @IpcHandle()
  apply(
    @RawEvent() event: IpcMainInvokeEvent,
    input: IpcPayload<'apply'>,
  ): Promise<IpcResponse<'apply'>> {
    return this.boundary.execute(event, 'apply', input, (parsed) => this.api.apply(parsed));
  }

  @IpcHandle()
  history(
    @RawEvent() event: IpcMainInvokeEvent,
    input: IpcPayload<'history'>,
  ): Promise<IpcResponse<'history'>> {
    return this.boundary.execute(event, 'history', input, (parsed) => this.api.history(parsed));
  }

  @IpcHandle()
  checkCurrentState(
    @RawEvent() event: IpcMainInvokeEvent,
    input: IpcPayload<'checkCurrentState'>,
  ): Promise<IpcResponse<'checkCurrentState'>> {
    return this.boundary.execute(event, 'checkCurrentState', input, (parsed) =>
      this.api.checkCurrentState(parsed),
    );
  }
}
