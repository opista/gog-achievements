import { Inject, Injectable } from '@nestjs/common';
import type { GamesData, AchievementsData } from '../../../shared/api';
import { gamesSchema, achievementsSchema, idSchema } from '../../../shared/schemas';
import { requireSuccess, type CliRunner, type CliCommand } from '../../cli-client';
import { DesktopError } from '../../errors';
import { CLI_RUNNER } from '../../workspace.tokens';
import { SessionService } from '../account/session.service';
import { PreviewStore } from '../../application/preview-store';
@Injectable()
export class LibraryService {
  constructor(
    @Inject(CLI_RUNNER) private readonly cli: CliRunner,
    @Inject(SessionService) private readonly session: SessionService,
    @Inject(PreviewStore) private readonly previews: PreviewStore,
  ) {}
  private async read(command: CliCommand): Promise<unknown> {
    return requireSuccess(await this.cli.run(command));
  }
  async games(): Promise<GamesData> {
    const account = await this.session.requireAccount();
    const data = gamesSchema.parse(await this.read({ kind: 'games' })) as GamesData;
    this.session.assertOwner(data.user_id, account);
    return data;
  }
  async achievements(gameId: string): Promise<AchievementsData> {
    gameId = idSchema.parse(gameId);
    const account = await this.session.requireAccount();
    const data = achievementsSchema.parse(
      await this.read({ kind: 'achievements', gameId }),
    ) as AchievementsData;
    this.session.assertOwner(data.user_id, account);
    if (data.game.id !== gameId)
      throw new DesktopError(
        'GAME_CHANGED',
        'Could not load the selected game. Refresh your library and try again.',
      );
    return data;
  }

  checkCurrentState({ gameId }: { gameId: string }): Promise<AchievementsData> {
    this.previews.clear();
    return this.achievements(gameId);
  }
}
