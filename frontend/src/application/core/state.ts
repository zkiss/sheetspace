/** Framework-independent save and startup states shared by application adapters. */
export type SaveStatus = 'saved' | 'saving' | 'failed';

export type StartupLoadState =
  | { status: 'loading' }
  | { status: 'loaded' }
  | { status: 'error'; message: string };
