import { Inject, Injectable } from '@nestjs/common';
import type { GamesData, AchievementsData, ExportInput, ExportResult } from '../../../shared/api';
import {
  gamesSchema,
  achievementsSchema,
  idSchema,
  exportInputSchema,
  exportResultSchema,
} from '../../../shared/schemas';
import { isAbsolute, resolve } from 'node:path';
import { requireSuccess, type CliRunner, type CliCommand } from '../../cli-client';
import { DesktopError } from '../../errors';
import { CLI_RUNNER, EXPORT_DESTINATION, type ExportDestination } from '../../workspace.tokens';
import { SessionService } from '../account/session.service';
import { PreviewStore } from '../../application/preview-store';
@Injectable()
export class LibraryService {
  constructor(
    @Inject(CLI_RUNNER) private readonly cli: CliRunner,
    @Inject(SessionService) private readonly session: SessionService,
    @Inject(PreviewStore) private readonly previews: PreviewStore,
    @Inject(EXPORT_DESTINATION)
    private readonly chooseExportFile: ExportDestination = async () => null,
  ) {}
  private async read(command: CliCommand): Promise<unknown> {
    return requireSuccess(await this.cli.run(command));
  }

  async exportAchievements(input: ExportInput): Promise<ExportResult> {
    const filters = exportInputSchema.parse(input);
    await this.session.requireExportSupport();
    await this.session.requireAccount();
    const file = await this.chooseExportFile(filters.gameId);
    if (file === null) return { cancelled: true };
    if (!isAbsolute(file))
      throw new DesktopError('INVALID_EXPORT_PATH', 'Choose an absolute export path.');
    const result = exportResultSchema.parse(
      await this.read({ kind: 'achievements-export', ...filters, file }),
    );
    if (result.path !== resolve(file))
      throw new DesktopError('INVALID_CLI_OUTPUT', 'The CLI returned a different export path.');
    return { cancelled: false, ...result };
  }
  async games(): Promise<GamesData> {
    const account = await this.session.requireAccount();
    const data = gamesSchema.parse(await this.read({ kind: 'games' }));
    this.session.assertOwner(data.user_id, account);
    return data;
  }
  async achievements(gameId: string): Promise<AchievementsData> {
    gameId = idSchema.parse(gameId);
    const account = await this.session.requireAccount();
    const data = achievementsSchema.parse(await this.read({ kind: 'achievements', gameId }));
    this.session.assertOwner(data.user_id, account);
    if (data.game.id !== gameId)
      throw new DesktopError(
        'GAME_CHANGED',
        'Could not load the selected game. Refresh your library and try again.',
      );
    return data;
  }

  async checkCurrentState({ gameId }: { gameId: string }): Promise<AchievementsData> {
    await this.previews.clear();
    return this.achievements(gameId);
  }
}
