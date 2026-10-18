import { CliClient, type CliRunner } from '../cli-client';
import type { CliSelection } from '../cli-updates/manager';

/** Each command captures its runner before starting. Switching never replaces running files. */
export class CliRuntime implements CliRunner {
  constructor(
    private runner: CliRunner,
    readonly create: (selection: CliSelection) => CliRunner = (selection) =>
      new CliClient(selection.executable),
  ) {}

  run(...args: Parameters<CliRunner['run']>): ReturnType<CliRunner['run']> {
    return this.runner.run(...args);
  }

  replace(runner: CliRunner): void {
    this.runner = runner;
  }
}
