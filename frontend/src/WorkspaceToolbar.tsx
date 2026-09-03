import type { WorkspaceViewport } from './appTypes';
import type { SaveStatus } from '@application/core/state';
import { WORKSPACE_PAN_STEP, WORKSPACE_ZOOM_STEP } from './workspaceGeometry';
import './WorkspaceToolbar.css';

function saveStatusText(status: SaveStatus) {
  if (status === 'saving') {
    return 'Saving...';
  }

  if (status === 'failed') {
    return 'Save failed - unsaved changes';
  }

  return 'Saved';
}

export function WorkspaceToolbar({
  canRetryFailedSaves,
  onCreateSheet,
  onPanWorkspace,
  onResetViewport,
  onRetryFailedSaves,
  onZoomWorkspace,
  saveStatus,
  sheetCount,
  viewport,
}: {
  canRetryFailedSaves: boolean;
  onCreateSheet: () => void;
  onPanWorkspace: (deltaX: number, deltaY: number) => void;
  onResetViewport: () => void;
  onRetryFailedSaves: () => void;
  onZoomWorkspace: (scale: number) => void;
  saveStatus: SaveStatus;
  sheetCount: number;
  viewport: WorkspaceViewport;
}) {
  return (
    <header className="workspace-toolbar" aria-label="Workspace toolbar">
      <div>
        <h1>Sheetspace</h1>
        <p>{sheetCount} sheets</p>
        <p className={`save-status save-status-${saveStatus}`} role="status" aria-label="Save status">
          {saveStatusText(saveStatus)}
        </p>
        {saveStatus === 'failed' ? (
          <button
            type="button"
            disabled={!canRetryFailedSaves}
            onClick={onRetryFailedSaves}
            title={canRetryFailedSaves ? 'Retry retained failed save operations' : 'This creation failure cannot be retried'}
          >
            Retry failed saves
          </button>
        ) : null}
      </div>
      <div className="workspace-toolbar-actions">
        <div className="workspace-viewport-controls" aria-label="Workspace viewport controls">
          <button type="button" aria-label="Pan workspace left" onClick={() => onPanWorkspace(-WORKSPACE_PAN_STEP, 0)}>
            ←
          </button>
          <button type="button" aria-label="Pan workspace right" onClick={() => onPanWorkspace(WORKSPACE_PAN_STEP, 0)}>
            →
          </button>
          <button type="button" aria-label="Pan workspace up" onClick={() => onPanWorkspace(0, -WORKSPACE_PAN_STEP)}>
            ↑
          </button>
          <button type="button" aria-label="Pan workspace down" onClick={() => onPanWorkspace(0, WORKSPACE_PAN_STEP)}>
            ↓
          </button>
          <button type="button" aria-label="Zoom workspace out" onClick={() => onZoomWorkspace(viewport.scale - WORKSPACE_ZOOM_STEP)}>
            -
          </button>
          <output aria-label="Workspace zoom level">{Math.round(viewport.scale * 100)}%</output>
          <button type="button" aria-label="Zoom workspace in" onClick={() => onZoomWorkspace(viewport.scale + WORKSPACE_ZOOM_STEP)}>
            +
          </button>
          <button type="button" aria-label="Reset workspace viewport" onClick={onResetViewport}>
            Reset
          </button>
        </div>
        <button type="button" onClick={onCreateSheet}>
          New sheet
        </button>
      </div>
    </header>
  );
}
