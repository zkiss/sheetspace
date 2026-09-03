import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CELL_EDITOR_MAX_HEIGHT, CELL_EDITOR_MAX_WIDTH, SheetGridCell } from '@grid/SheetGridCell';
import type { CellEditSession } from './cellInteractionContracts';
import { cellTargetAt } from '@grid/cellInteraction';
import { sheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';

afterEach(() => {
  cleanup();
});

function testSheet() {
  return tabularProjection(sheetDocument({ id: 'sheet-inputs', name: 'Inputs' }));
}

function renderCell(overrides: Partial<Parameters<typeof SheetGridCell>[0]> = {}) {
  const sheet = testSheet();
  const props = {
    cellKey: 'A1',
    displayText: 'Value',
    editingCell: null,
    isActive: true,
    isEditing: false,
    cellInteraction: {
      clear: vi.fn(),
      navigate: vi.fn(),
      select: vi.fn(),
      startEditing: vi.fn(),
    },
    editorInteraction: {
      cancel: vi.fn(),
      commit: vi.fn(),
      commitAndNavigate: vi.fn(),
      updateValue: vi.fn(),
    },
    registerCell: vi.fn(),
    sheet,
    ...overrides,
  };

  render(
    <table>
      <tbody>
        <tr>
          <SheetGridCell {...props} columnIndex={1} />
        </tr>
      </tbody>
    </table>,
  );

  return props;
}

describe('SheetGridCell', () => {
  it('selects, starts editing, and navigates through intent callbacks', () => {
    const props = renderCell();
    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });

    fireEvent.click(cell);
    const target = cellTargetAt(props.sheet, 'A1');
    expect(props.cellInteraction.select).toHaveBeenCalledWith(target);

    fireEvent.doubleClick(cell);
    expect(props.cellInteraction.startEditing).toHaveBeenCalledWith(target);

    fireEvent.keyDown(cell, { key: 'ArrowRight' });
    expect(props.cellInteraction.navigate).toHaveBeenCalledWith(target, 'right');

    fireEvent.keyDown(cell, { key: 'Backspace' });
    expect(props.cellInteraction.clear).toHaveBeenCalledWith(target);
  });

  it('renders the editor and commits or cancels editor keyboard actions', () => {
    const sheet = testSheet();
    const editingCell: CellEditSession = {
      target: cellTargetAt(sheet, 'A1')!,
      draft: 'Draft',
    };
    const props = renderCell({ editingCell, isEditing: true });
    const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
    expect(editor.style.height).toContain('1.65rem');

    fireEvent.change(editor, { target: { value: 'Updated' } });
    expect(props.editorInteraction.updateValue).toHaveBeenCalledWith('Updated');

    fireEvent.blur(editor, { target: { value: 'Updated' } });
    expect(props.editorInteraction.commit).toHaveBeenCalledWith({ ...editingCell, draft: 'Updated' });

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(props.editorInteraction.commitAndNavigate).toHaveBeenCalledWith(
      { ...editingCell, draft: 'Updated' },
      'enter',
    );

    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(props.editorInteraction.cancel).toHaveBeenCalled();
  });

  it('anchors multiline editor sizing to the cell with documented maximum dimensions', () => {
    const sheet = testSheet();
    const editingCell: CellEditSession = {
      target: cellTargetAt(sheet, 'A1')!,
      draft: '=SUM(\n  B1,\n  B2,\n  B3,\n  B4,\n  B5,\n  B6,\n  B7,\n  B8,\n  B9\n)',
    };

    renderCell({ editingCell, isEditing: true });

    const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    expect(editor).toHaveAttribute('data-multiline-editor', 'true');
    expect(editor).toHaveAttribute('data-max-width', CELL_EDITOR_MAX_WIDTH);
    expect(editor).toHaveAttribute('data-max-height', CELL_EDITOR_MAX_HEIGHT);
    expect(editor).toHaveAttribute('data-visible-lines', '8');
    expect(editor).toHaveStyle({
      maxHeight: CELL_EDITOR_MAX_HEIGHT,
      maxWidth: CELL_EDITOR_MAX_WIDTH,
      overflow: 'auto',
    });
    expect(cell).toHaveClass('sheet-grid-cell', 'sheet-grid-cell-editing');
  });
});
