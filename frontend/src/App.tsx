import { FormEvent, MouseEvent, useState } from 'react';
import './App.css';
import {
  cellKey,
  columnIndexToLabel,
  createEmptyWorkbook,
  createSheet,
  renameSheet,
  type Sheet,
  type Workbook,
  type WorkspacePosition,
} from './workbook';

type PendingSheetCreation = {
  position: WorkspacePosition;
  label: string;
};

type PendingSheetRename = {
  sheetId: string;
  currentName: string;
};

type ActiveCellSelection = {
  sheetId: string;
  cellKey: string;
};

const SHEET_FRAME_WIDTH = 240;
const SHEET_FRAME_HEIGHT = 160;

type AppProps = {
  initialWorkbook?: Workbook;
};

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

function SheetGrid({
  activeCell,
  onSelectCell,
  sheet,
}: {
  activeCell: ActiveCellSelection | null;
  onSelectCell: (selection: ActiveCellSelection) => void;
  sheet: Sheet;
}) {
  const columns = Array.from({ length: sheet.columnCount }, (_, columnIndex) => ({
    index: columnIndex,
    label: columnIndexToLabel(columnIndex),
  }));
  const rows = Array.from({ length: sheet.rowCount }, (_, rowIndex) => rowIndex);

  return (
    <table aria-label={`${sheet.name} grid`} className="sheet-grid" data-testid="sheet-grid">
      <thead>
        <tr>
          <th aria-label="Grid corner" className="sheet-grid-corner" scope="col" />
          {columns.map((column) => (
            <th className="sheet-grid-column-header" key={column.index} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((rowIndex) => (
          <tr key={rowIndex}>
            <th className="sheet-grid-row-header" scope="row">
              {rowIndex + 1}
            </th>
            {columns.map((column) => {
              const address = { columnIndex: column.index, rowIndex };
              const key = cellKey(address);
              const cell = sheet.cells[key];
              const isActive = activeCell?.sheetId === sheet.id && activeCell.cellKey === key;

              return (
                <td
                  aria-label={`${sheet.name} ${key}${cell ? '' : ' empty'} cell`}
                  className={`sheet-grid-cell${isActive ? ' sheet-grid-cell-active' : ''}`}
                  data-active-cell={isActive ? 'true' : undefined}
                  data-cell-key={key}
                  data-testid="sheet-grid-cell"
                  key={key}
                  onClick={() => onSelectCell({ sheetId: sheet.id, cellKey: key })}
                  tabIndex={0}
                >
                  {cell?.raw ?? ''}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function App({ initialWorkbook }: AppProps = {}) {
  const [workbook, setWorkbook] = useState<Workbook>(() => initialWorkbook ?? createEmptyWorkbook());
  const [pendingCreation, setPendingCreation] = useState<PendingSheetCreation | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingSheetRename | null>(null);
  const [activeCell, setActiveCell] = useState<ActiveCellSelection | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [error, setError] = useState('');

  function openCreationDialog(position: WorkspacePosition, label: string) {
    setPendingCreation({ position, label });
    setSheetName('');
    setError('');
  }

  function openRenameDialog(sheet: Sheet) {
    setPendingRename({ sheetId: sheet.id, currentName: sheet.name });
    setSheetName(sheet.name);
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

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingRename) {
      return;
    }

    const result = renameSheet(workbook, pendingRename.sheetId, sheetName);
    if (!result.ok) {
      setError(validationMessage(result.reason));
      return;
    }

    setWorkbook(result.value);
    setPendingRename(null);
    setSheetName('');
    setError('');
  }

  function closeDialog() {
    setPendingCreation(null);
    setPendingRename(null);
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
            className={`sheet-frame${activeCell?.sheetId === sheet.id ? ' sheet-frame-active' : ''}`}
            data-active-sheet={activeCell?.sheetId === sheet.id ? 'true' : undefined}
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
            <header className="sheet-frame-header">
              <h2>{sheet.name}</h2>
              <button type="button" onClick={() => openRenameDialog(sheet)}>
                Rename
              </button>
            </header>
            <div className="sheet-frame-body" data-testid="sheet-frame-body">
              <SheetGrid activeCell={activeCell} onSelectCell={setActiveCell} sheet={sheet} />
            </div>
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

      {pendingRename ? (
        <div className="dialog-backdrop" role="presentation">
          <form aria-label="Rename sheet" className="sheet-dialog" onSubmit={handleRenameSubmit}>
            <h2>Rename {pendingRename.currentName}</h2>
            <label htmlFor="rename-sheet-name">Sheet name</label>
            <input
              aria-describedby={error ? 'rename-sheet-name-error' : undefined}
              autoFocus
              id="rename-sheet-name"
              onChange={(event) => {
                setSheetName(event.target.value);
                setError('');
              }}
              value={sheetName}
            />
            {error ? (
              <p className="form-error" id="rename-sheet-name-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button type="button" onClick={closeDialog}>
                Cancel
              </button>
              <button type="submit">Save</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
