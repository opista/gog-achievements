export const CLI_RUNNER = Symbol('CLI_RUNNER');
export const PROCESS_PROBE = Symbol('PROCESS_PROBE');
export const WORKSPACE_VERSIONS = Symbol('WORKSPACE_VERSIONS');
export interface WorkspaceVersions {
  app: string;
  cli: string;
}
