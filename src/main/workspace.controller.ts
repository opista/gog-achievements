import { IpcController, IpcHandle, RawEvent } from '@electron-ipc-bridge/core';
import { Inject, Injectable } from '@nestjs/common';
import type { IpcMainInvokeEvent } from 'electron';
import type {
  AchievementsData,
  ApplyResult,
  AuthStatus,
  DatesInput,
  DesktopApi,
  GamesData,
  InitializeResult,
  IpcResult,
  OperationRecord,
  PreviewResult,
  Queue,
  SelectionInput,
  WorkspaceApi,
} from '../shared/api';
import { IpcBoundary } from './ipc';
import { APP_ACTIONS, WORKSPACE_API } from './ipc.tokens';

@Injectable()
@IpcController('workspace')
export class WorkspaceController {
  constructor(
    @Inject(WORKSPACE_API) private readonly api: WorkspaceApi,
    @Inject(APP_ACTIONS) private readonly appActions: Pick<DesktopApi, 'checkForUpdates'>,
    @Inject(IpcBoundary) private readonly boundary: IpcBoundary,
  ) {}

  @IpcHandle()
  initialize(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: undefined,
  ): Promise<IpcResult<InitializeResult>> {
    return this.boundary.execute(event, 'initialize', payload, () => this.api.initialize());
  }

  @IpcHandle()
  checkForUpdates(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: undefined,
  ): Promise<IpcResult<void>> {
    return this.boundary.execute(event, 'checkForUpdates', payload, () =>
      this.appActions.checkForUpdates(),
    );
  }

  @IpcHandle()
  login(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: undefined,
  ): Promise<IpcResult<AuthStatus>> {
    return this.boundary.execute(event, 'login', payload, () => this.api.login());
  }

  @IpcHandle()
  logout(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: undefined,
  ): Promise<IpcResult<AuthStatus>> {
    return this.boundary.execute(event, 'logout', payload, () => this.api.logout());
  }

  @IpcHandle()
  listGames(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: undefined,
  ): Promise<IpcResult<GamesData>> {
    return this.boundary.execute(event, 'listGames', payload, () => this.api.listGames());
  }

  @IpcHandle()
  listAchievements(
    @RawEvent() event: IpcMainInvokeEvent,
    gameId: string,
  ): Promise<IpcResult<AchievementsData>> {
    return this.boundary.execute(event, 'listAchievements', gameId, () =>
      this.api.listAchievements(gameId),
    );
  }

  @IpcHandle()
  getQueue(
    @RawEvent() event: IpcMainInvokeEvent,
    gameId: string,
  ): Promise<IpcResult<Queue | null>> {
    return this.boundary.execute(event, 'getQueue', gameId, () => this.api.getQueue(gameId));
  }

  @IpcHandle()
  listQueues(
    @RawEvent() event: IpcMainInvokeEvent,
    payload?: undefined,
  ): Promise<IpcResult<Queue[]>> {
    return this.boundary.execute(event, 'listQueues', payload, () => this.api.listQueues());
  }

  @IpcHandle()
  addAchievements(
    @RawEvent() event: IpcMainInvokeEvent,
    input: SelectionInput,
  ): Promise<IpcResult<Queue>> {
    return this.boundary.execute(event, 'addAchievements', input, () =>
      this.api.addAchievements(input),
    );
  }

  @IpcHandle()
  removeAchievements(
    @RawEvent() event: IpcMainInvokeEvent,
    input: SelectionInput,
  ): Promise<IpcResult<Queue>> {
    return this.boundary.execute(event, 'removeAchievements', input, () =>
      this.api.removeAchievements(input),
    );
  }

  @IpcHandle()
  setDates(@RawEvent() event: IpcMainInvokeEvent, input: DatesInput): Promise<IpcResult<Queue>> {
    return this.boundary.execute(event, 'setDates', input, () => this.api.setDates(input));
  }

  @IpcHandle()
  preview(
    @RawEvent() event: IpcMainInvokeEvent,
    input: { gameId: string },
  ): Promise<IpcResult<PreviewResult>> {
    return this.boundary.execute(event, 'preview', input, () => this.api.preview(input));
  }

  @IpcHandle()
  apply(
    @RawEvent() event: IpcMainInvokeEvent,
    input: { previewToken: string },
  ): Promise<IpcResult<ApplyResult>> {
    return this.boundary.execute(event, 'apply', input, () => this.api.apply(input));
  }

  @IpcHandle()
  history(
    @RawEvent() event: IpcMainInvokeEvent,
    input: { gameId?: string },
  ): Promise<IpcResult<OperationRecord[]>> {
    return this.boundary.execute(event, 'history', input, () => this.api.history(input));
  }

  @IpcHandle()
  checkCurrentState(
    @RawEvent() event: IpcMainInvokeEvent,
    input: { gameId: string },
  ): Promise<IpcResult<AchievementsData>> {
    return this.boundary.execute(event, 'checkCurrentState', input, () =>
      this.api.checkCurrentState(input),
    );
  }
}
