export interface CliUpdateState {
  supported: boolean;
  currentVersion: string;
  bundledVersion: string;
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'unavailable' | 'fallback';
  pendingVersion?: string;
  message: string;
}

export interface CliUpdateActions {
  getCliUpdateState(): Promise<CliUpdateState>;
}

export function disabledCliUpdates(version: string): CliUpdateState {
  return {
    supported: false,
    currentVersion: version,
    bundledVersion: version,
    status: 'idle',
    message: 'Automatic component updates are available in the installed app.',
  };
}
