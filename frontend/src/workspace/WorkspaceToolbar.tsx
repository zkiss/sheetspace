import { useEffect, useState, type ReactNode } from 'react';
import type { SaveStatus } from '@application/core/state';
import '@workspace/WorkspaceToolbar.css';

function saveStatusText(status: SaveStatus) {
  if (status === 'saving') return 'Saving changes';
  if (status === 'failed') return 'Save failed';
  return 'All changes saved';
}

export function WorkspaceToolbar({
  canRedo,
  canRetryFailedSaves,
  canUndo,
  formatControls,
  onCreateSheet,
  onRedo,
  onResetViewport,
  onRetryFailedSaves,
  onUndo,
  saveStatus,
}: {
  canRedo: boolean;
  canRetryFailedSaves: boolean;
  canUndo: boolean;
  formatControls: ReactNode;
  onCreateSheet: () => void;
  onRedo: () => void;
  onResetViewport: () => void;
  onRetryFailedSaves: () => void;
  onUndo: () => void;
  saveStatus: SaveStatus;
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  useEffect(() => {
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('keydown', closeMenu);
    return () => window.removeEventListener('keydown', closeMenu);
  }, []);
  const toggleMenu = (menu: string) => setOpenMenu((current) => current === menu ? null : menu);
  const run = (action: () => void) => {
    action();
    setOpenMenu(null);
  };

  return (
    <div className="workspace-chrome">
      <header className="workspace-toolbar" aria-label="Workspace menu bar">
        <nav aria-label="Application menu" className="workspace-menu-bar">
          <div className="workspace-menu">
            <button aria-expanded={openMenu === 'file'} aria-haspopup="menu" onClick={() => toggleMenu('file')} type="button">File</button>
            {openMenu === 'file' ? <div className="workspace-menu-popover" role="menu">
              <button onClick={() => run(onCreateSheet)} role="menuitem" type="button">New sheet<span>Shift+N</span></button>
            </div> : null}
          </div>
          <div className="workspace-menu">
            <button aria-expanded={openMenu === 'edit'} aria-haspopup="menu" onClick={() => toggleMenu('edit')} type="button">Edit</button>
            {openMenu === 'edit' ? <div className="workspace-menu-popover" role="menu">
              <button disabled={!canUndo} onClick={() => run(onUndo)} role="menuitem" type="button">Undo<span>Ctrl/Cmd+Z</span></button>
              <button disabled={!canRedo} onClick={() => run(onRedo)} role="menuitem" type="button">Redo<span>Ctrl/Cmd+Shift+Z</span></button>
            </div> : null}
          </div>
          <div className="workspace-menu">
            <button aria-expanded={openMenu === 'view'} aria-haspopup="menu" onClick={() => toggleMenu('view')} type="button">View</button>
            {openMenu === 'view' ? <div className="workspace-menu-popover" role="menu">
              <button onClick={() => run(onResetViewport)} role="menuitem" type="button">Reset view</button>
            </div> : null}
          </div>
          <div className="workspace-menu">
            <button aria-expanded={openMenu === 'format'} aria-haspopup="menu" onClick={() => toggleMenu('format')} type="button">Format</button>
            {openMenu === 'format' ? <div className="workspace-menu-popover workspace-menu-note" role="menu">Select cells to reveal formatting controls.</div> : null}
          </div>
          <div className="workspace-menu">
            <button aria-expanded={openMenu === 'help'} aria-haspopup="menu" onClick={() => toggleMenu('help')} type="button">Help</button>
            {openMenu === 'help' ? <div className="workspace-menu-popover workspace-menu-note" role="menu">Drag the canvas to pan. Scroll or pinch to zoom.</div> : null}
          </div>
        </nav>
        <button
          aria-label={saveStatusText(saveStatus)}
          className={`save-status-dot save-status-${saveStatus}`}
          disabled={saveStatus !== 'failed' || !canRetryFailedSaves}
          onClick={onRetryFailedSaves}
          title={saveStatus === 'failed' ? 'Save failed. Retry changes.' : saveStatusText(saveStatus)}
          type="button"
        />
      </header>
      {formatControls}
    </div>
  );
}
