export interface CliUpdateState {
  supported: boolean;
  automatic: boolean;
  currentVersion: string;
  bundledVersion: string;
  status: 'idle' | 'checking' | 'downloading' | 'available' | 'ready' | 'unavailable' | 'fallback';
  pendingVersion?: string;
  message: string;
}

export interface CliUpdateActions {
  getCliUpdateState(): Promise<CliUpdateState>;
  setAutomaticCliUpdates(input: { enabled: boolean }): Promise<CliUpdateState>;
  useBundledCli(): Promise<CliUpdateState>;
}

export function disabledCliUpdates(version: string): CliUpdateState {
  return {
    supported: false,
    automatic: false,
    currentVersion: version,
    bundledVersion: version,
    status: 'idle',
    message: 'Automatic component updates are available in the installed app.',
  };
}
