export const CLI_RUNNER = Symbol('CLI_RUNNER');
export const PROCESS_PROBE = Symbol('PROCESS_PROBE');
export const WORKSPACE_VERSIONS = Symbol('WORKSPACE_VERSIONS');
export const EXPORT_DESTINATION = Symbol('EXPORT_DESTINATION');
export type ExportDestination = (gameId: string) => Promise<string | null>;
export interface WorkspaceVersions {
  app: string;
  cli: string;
}
