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
  formatControls,
  onCreateSheet,
  onRetryFailedSaves,
  saveStatus,
}: {
  canRetryFailedSaves: boolean;
  formatControls: ReactNode;
  onCreateSheet: () => void;
  onRetryFailedSaves: () => void;
  saveStatus: SaveStatus;
}) {
  return (
    <div className="workspace-chrome">
      <header className="workspace-toolbar" aria-label="Workspace controls">
        <button className="workspace-new-sheet" onClick={onCreateSheet} type="button">New sheet</button>
        <div className="workspace-format-slot">{formatControls}</div>
        <span className="save-status-indicator" data-status-text={saveStatus === 'failed' ? 'Save failed. Click to retry.' : saveStatusText(saveStatus)}>
          {saveStatus === 'failed' && canRetryFailedSaves ? (
            <button aria-label="Save failed. Retry changes." className="save-status-dot save-status-failed" onClick={onRetryFailedSaves} type="button" />
          ) : <span aria-label={saveStatusText(saveStatus)} className={`save-status-dot save-status-${saveStatus}`} role="status" />}
        </span>
      </header>
    </div>
  );
}
