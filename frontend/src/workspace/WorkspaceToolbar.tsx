import type { ReactNode } from 'react';
import type { SaveStatus } from '@application/core/state';
import '@workspace/WorkspaceToolbar.css';

function saveStatusText(status: SaveStatus) {
  if (status === 'saving') return 'Saving changes';
  if (status === 'failed') return 'Save failed';
  return 'All changes saved';
}

export function WorkspaceToolbar({
  canRetryFailedSaves,
  errorCount = 0,
  onOpenErrors,
  errorsDisabled = false,
  errorsOpen = false,
  referencesVisible = false,
  formatControls,
  onCreateSheet,
  onOpenDataModels,
  onOpenCommandPalette,
  onToggleMaximise,
  onFocusMaximise,
  onBlurMaximise,
  maximised = false,
  canMaximise = false,
  titles,
  onGoBack,
  onGoForward,
  canGoBack = false,
  canGoForward = false,
  onRetryFailedSaves,
  onToggleReferences = () => {},
  saveStatus,
}: {
  canRetryFailedSaves: boolean;
  errorCount?: number;
  onOpenErrors?: () => void;
  errorsDisabled?: boolean;
  errorsOpen?: boolean;
  referencesVisible?: boolean;
  formatControls: ReactNode;
  onCreateSheet: () => void;
  onOpenDataModels?: () => void;
  onOpenCommandPalette?: () => void;
  onToggleMaximise?: () => void;
  onFocusMaximise?: () => void;
  onBlurMaximise?: () => void;
  maximised?: boolean;
  canMaximise?: boolean;
  titles: { back: string; forward: string; commandPalette: string; errorsList: string };
  onGoBack?: () => void;
  onGoForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onRetryFailedSaves: () => void;
  onToggleReferences?: () => void;
  saveStatus: SaveStatus;
}) {
  return (
    <div className="workspace-chrome">
      <header className="workspace-toolbar" aria-label="Workspace controls">
        <button className="workspace-new-sheet" onClick={onCreateSheet} type="button">New sheet</button>
        <button aria-label="Back" className="workspace-new-sheet" data-workspace-navigation disabled={!canGoBack} onClick={onGoBack} title={titles.back} type="button">Back</button>
        <button aria-label="Forward" className="workspace-new-sheet" data-workspace-navigation disabled={!canGoForward} onClick={onGoForward} title={titles.forward} type="button">Forward</button>
        <button className="workspace-new-sheet" data-workspace-navigation id="data-models-button" onClick={() => onOpenDataModels?.()} type="button">Data models</button>
        <button aria-label="Command palette" className="workspace-new-sheet" data-workspace-navigation onClick={onOpenCommandPalette} title={titles.commandPalette} type="button">Commands</button>
        <button aria-pressed={referencesVisible} className="workspace-new-sheet" data-workspace-navigation onClick={onToggleReferences} type="button">{referencesVisible ? 'Hide references' : 'Show references'}</button>
        <div className="workspace-format-slot">{formatControls}</div>
        <div className="workspace-status">
        {errorCount > 0 && <button aria-label={`Toggle error list (${errorCount} ${errorCount === 1 ? 'error' : 'errors'})`} aria-pressed={errorsOpen} className="workbook-error-indicator" data-workspace-navigation disabled={errorsDisabled} onClick={onOpenErrors} title={titles.errorsList} type="button">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2 23 21H1Z" fill="#f3c54b" stroke="#9a6b00" strokeLinejoin="round" /><path d="M12 8v6m0 3v.2" fill="none" stroke="#533900" strokeLinecap="round" strokeWidth="2" /></svg>
        </button>}
        <span className="save-status-indicator" data-status-text={saveStatus === 'failed' && canRetryFailedSaves ? 'Save failed. Click to retry.' : saveStatusText(saveStatus)}>
          {saveStatus === 'failed' && canRetryFailedSaves ? (
            <button aria-label="Save failed. Retry changes." className="save-status-dot save-status-failed" onClick={onRetryFailedSaves} type="button" />
          ) : <span aria-hidden="true" className={`save-status-dot save-status-${saveStatus}`} />}
          <span aria-label={saveStatusText(saveStatus)} className="save-status-announcement" role="status">{saveStatusText(saveStatus)}</span>
        </span>
        </div>
        {maximised && <button aria-label="Restore to workspace" className="workspace-new-sheet workspace-restore" data-workspace-navigation data-workspace-presentation-action disabled={!canMaximise} onFocus={onFocusMaximise} onBlur={onBlurMaximise} onMouseDown={(event) => event.preventDefault()} onClick={onToggleMaximise} title="Restore to workspace" type="button"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 6h3V3M10 3v3h3M13 10h-3v3M6 13v-3H3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg></button>}
      </header>
    </div>
  );
}
