import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectGridAxes } from './gridAxisProjection';
import { SheetGrid } from './SheetGrid';
import { sheetDocument } from './test/workbookFactories';
import { cellIdentityAt, tabularProjection } from './workbook';

afterEach(cleanup);

describe('SheetGrid creating axis slots', () => {
  it('uses loading-only, non-addressable row and column placeholders', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet-inputs', name: 'Inputs' }));
    const axisProjection = projectGridAxes(sheet, {
      rows: [{ kind: 'creating', operationId: 'row-request', boundary: 1 }],
      columns: [{ kind: 'creating', operationId: 'column-request', boundary: 1 }],
    });

    render(
      <SheetGrid
        activeCellKey={null}
        axisProjection={axisProjection}
        cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
        editingCell={null}
        editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
        formulaResults={{}}
        keyboardFocusCellKey={null}
        navigationHighlightCellKey={null}
        scrollContainerRef={createRef<HTMLElement>()}
        sheet={sheet}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Creating column' })).toHaveTextContent('Creating…');
    expect(screen.getByRole('rowheader', { name: 'Creating row' })).toHaveTextContent('Creating…');
    expect(screen.getAllByRole('cell', { name: 'Creating cell' })).not.toHaveLength(0);
    expect(document.querySelector('[aria-label="Creating cell"][data-cell-key]')).toBeNull();
  });

  it('keeps editing, formulas, selection, and navigation on durable cells only', () => {
    const sheet = tabularProjection(sheetDocument({
      id: 'sheet-inputs',
      name: 'Inputs',
      cells: { A1: '=1+1', B1: 'Original' },
    }));
    const axisProjection = projectGridAxes(sheet, {
      rows: [{ kind: 'creating', operationId: 'row-request', boundary: Number.MAX_SAFE_INTEGER }],
      columns: [{ kind: 'creating', operationId: 'column-request', boundary: Number.MAX_SAFE_INTEGER }],
    });
    const cellInteraction = {
      clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn(),
    };
    const editorInteraction = {
      cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn(),
    };

    render(
      <SheetGrid
        activeCellKey="B1"
        axisProjection={axisProjection}
        cellInteraction={cellInteraction}
        editingCell={{
          target: { sheetId: sheet.id, cell: cellIdentityAt(sheet, 'B1')! },
          draft: 'Edited while appending',
        }}
        editorInteraction={editorInteraction}
        formulaResults={{
          [sheet.id]: { A1: { kind: 'number', value: 2, display: '2' } },
        }}
        keyboardFocusCellKey="B1"
        navigationHighlightCellKey="A1"
        navigationHighlightRange={undefined}
        scrollContainerRef={createRef<HTMLElement>()}
        selectedRange={{
          start: { rowIndex: 0, columnIndex: 0 },
          end: { rowIndex: 0, columnIndex: 1 },
        }}
        sheet={sheet}
      />,
    );

    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('2');
    expect(formulaCell).toHaveAttribute('data-navigation-highlight', 'true');
    expect(formulaCell).toHaveAttribute('data-reference-selected', 'true');

    const editedCell = screen.getByRole('cell', { name: 'Inputs B1 cell' });
    expect(editedCell).toHaveAttribute('data-cell-key', 'B1');
    expect(editedCell).toHaveAttribute('data-editing-cell', 'true');
    expect(editedCell).toHaveAttribute('data-reference-selected', 'true');
    const editor = screen.getByRole('textbox', { name: 'Inputs B1 editor' });
    expect(editor).toHaveValue('Edited while appending');
    fireEvent.change(editor, { target: { value: 'Committed independently' } });
    expect(editorInteraction.updateValue).toHaveBeenCalledWith('Committed independently');

    for (const creatingCell of screen.getAllByRole('cell', { name: 'Creating cell' })) {
      expect(creatingCell).not.toHaveAttribute('data-cell-key');
      expect(creatingCell).not.toHaveAttribute('data-active-cell');
      expect(creatingCell).not.toHaveAttribute('data-editing-cell');
      expect(creatingCell).not.toHaveAttribute('data-navigation-highlight');
      expect(creatingCell).not.toHaveAttribute('data-reference-selected');
      fireEvent.click(creatingCell);
      fireEvent.doubleClick(creatingCell);
      fireEvent.keyDown(creatingCell, { key: 'ArrowRight' });
    }
    expect(cellInteraction.select).not.toHaveBeenCalled();
    expect(cellInteraction.startEditing).not.toHaveBeenCalled();
    expect(cellInteraction.navigate).not.toHaveBeenCalled();
  });
});
