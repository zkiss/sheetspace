import { FormEvent, MouseEvent, useState } from 'react';
import './App.css';
import { createEmptyWorkbook, createSheet, type Workbook, type WorkspacePosition } from './workbook';

type PendingSheetCreation = {
  position: WorkspacePosition;
  label: string;
};

const SHEET_FRAME_WIDTH = 240;
const SHEET_FRAME_HEIGHT = 160;

function getWorkspacePoint(
  event: Pick<MouseEvent<HTMLElement>, 'clientX' | 'clientY'>,
  element: HTMLElement,
): WorkspacePosition {
  const rect = element.getBoundingClientRect();

  return {
    x: Math.round(event.clientX - rect.left + element.scrollLeft),
    y: Math.round(event.clientY - rect.top + element.scrollTop),
  };
}

function getViewportCenter(element: HTMLElement): WorkspacePosition {
  return {
    x: Math.round(element.scrollLeft + element.clientWidth / 2),
    y: Math.round(element.scrollTop + element.clientHeight / 2),
  };
}

function validationMessage(reason: 'empty' | 'duplicate' | 'unknown-sheet') {
  if (reason === 'empty') {
    return 'Sheet name is required.';
  }

  if (reason === 'unknown-sheet') {
    return 'The target sheet could not be found.';
  }

  return 'A sheet with that name already exists.';
}

export function App() {
  const [workbook, setWorkbook] = useState<Workbook>(() => createEmptyWorkbook());
  const [pendingCreation, setPendingCreation] = useState<PendingSheetCreation | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [error, setError] = useState('');

  function openCreationDialog(position: WorkspacePosition, label: string) {
    setPendingCreation({ position, label });
    setSheetName('');
    setError('');
  }

  function handleToolbarCreate(event: MouseEvent<HTMLButtonElement>) {
    const workspace = event.currentTarget
      .closest('.workspace-shell')
      ?.querySelector<HTMLElement>('[data-testid="workspace-surface"]');

    if (!workspace) {
      return;
    }

    openCreationDialog(getViewportCenter(workspace), 'Create sheet at viewport center');
  }

  function handleContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    openCreationDialog(getWorkspacePoint(event, event.currentTarget), 'Create sheet here');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingCreation) {
      return;
    }

    const result = createSheet({
      id: `sheet-${workbook.sheets.length + 1}`,
      name: sheetName,
      existingSheets: workbook.sheets,
      position: pendingCreation.position,
    });

    if (!result.ok) {
      setError(validationMessage(result.reason));
      return;
    }

    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: [...currentWorkbook.sheets, result.value],
    }));
    setPendingCreation(null);
    setSheetName('');
    setError('');
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-toolbar" aria-label="Workspace toolbar">
        <div>
          <h1>Sheetspace</h1>
          <p>{workbook.sheets.length} sheets</p>
        </div>
        <button type="button" onClick={handleToolbarCreate}>
          New sheet
        </button>
      </header>

      <section
        aria-label="Spatial workspace"
        className="workspace-surface"
        data-testid="workspace-surface"
        onContextMenu={handleContextMenu}
      >
        {workbook.sheets.length === 0 ? (
          <p className="empty-workspace">Right-click the workspace or use New sheet to create a sheet.</p>
        ) : null}

        {workbook.sheets.map((sheet) => (
          <article
            aria-label={`Sheet ${sheet.name}`}
            className="sheet-frame"
            data-column-count={sheet.columnCount}
            data-row-count={sheet.rowCount}
            data-sheet-id={sheet.id}
            data-testid="sheet-frame"
            key={sheet.id}
            style={{
              left: sheet.position.x,
              top: sheet.position.y,
              width: SHEET_FRAME_WIDTH,
              height: SHEET_FRAME_HEIGHT,
            }}
          >
            <h2>{sheet.name}</h2>
            <p>
              {sheet.columnCount} columns x {sheet.rowCount} rows
            </p>
          </article>
        ))}
      </section>

      {pendingCreation ? (
        <div className="dialog-backdrop" role="presentation">
          <form aria-label="Create sheet" className="sheet-dialog" onSubmit={handleSubmit}>
            <h2>{pendingCreation.label}</h2>
            <label htmlFor="sheet-name">Sheet name</label>
            <input
              aria-describedby={error ? 'sheet-name-error' : undefined}
              autoFocus
              id="sheet-name"
              onChange={(event) => {
                setSheetName(event.target.value);
                setError('');
              }}
              value={sheetName}
            />
            {error ? (
              <p className="form-error" id="sheet-name-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button type="button" onClick={() => setPendingCreation(null)}>
                Cancel
              </button>
              <button type="submit">Create</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
