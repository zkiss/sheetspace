import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSheet } from './workbook';
import { CELL_EDITOR_MAX_HEIGHT, CELL_EDITOR_MAX_WIDTH, SheetGridCell } from './SheetGridCell';
import type { EditingCell } from './appTypes';

afterEach(() => {
  cleanup();
});

function testSheet() {
  const result = createSheet({ id: 'sheet-inputs', name: 'Inputs' });
  if (!result.ok) {
    throw new Error('Failed to create test sheet');
  }

  return result.value;
}

function renderCell(overrides: Partial<Parameters<typeof SheetGridCell>[0]> = {}) {
  const sheet = testSheet();
  const props = {
    cellKey: 'A1',
    displayText: 'Value',
    editingCell: null,
    isActive: true,
    isEditing: false,
    onCancelEdit: vi.fn(),
    onClearCell: vi.fn(),
    onCommitEdit: vi.fn(),
    onCommitEditAndNavigate: vi.fn(),
    onEditValueChange: vi.fn(),
    onNavigateCell: vi.fn(),
    onSelectCell: vi.fn(),
    onStartEdit: vi.fn(),
    registerCell: vi.fn(),
    sheet,
    ...overrides,
  };

  render(
    <table>
      <tbody>
        <tr>
          <SheetGridCell {...props} />
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
    expect(props.onSelectCell).toHaveBeenCalledWith({ sheetId: 'sheet-inputs', cellKey: 'A1' });

    fireEvent.doubleClick(cell);
    expect(props.onStartEdit).toHaveBeenCalledWith({ sheetId: 'sheet-inputs', cellKey: 'A1' });

    fireEvent.keyDown(cell, { key: 'ArrowRight' });
    expect(props.onNavigateCell).toHaveBeenCalledWith(props.sheet, 'A1', 'right');

    fireEvent.keyDown(cell, { key: 'Backspace' });
    expect(props.onClearCell).toHaveBeenCalledWith({ sheetId: 'sheet-inputs', cellKey: 'A1' });
  });

  it('renders the editor and commits or cancels editor keyboard actions', () => {
    const editingCell: EditingCell = {
      sheetId: 'sheet-inputs',
      cellKey: 'A1',
      value: 'Draft',
    };
    const props = renderCell({ editingCell, isEditing: true });
    const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });

    fireEvent.change(editor, { target: { value: 'Updated' } });
    expect(props.onEditValueChange).toHaveBeenCalledWith('Updated');

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(props.onCommitEditAndNavigate).toHaveBeenCalledWith(
      editingCell,
      'enter',
    );

    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(props.onCancelEdit).toHaveBeenCalled();
  });

  it('anchors multiline editor sizing to the cell with documented maximum dimensions', () => {
    const editingCell: EditingCell = {
      sheetId: 'sheet-inputs',
      cellKey: 'A1',
      value: '=SUM(\n  B1,\n  B2,\n  B3,\n  B4,\n  B5,\n  B6,\n  B7,\n  B8,\n  B9\n)',
    };

    renderCell({ editingCell, isEditing: true });

    const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
    expect(editor).toHaveAttribute('data-multiline-editor', 'true');
    expect(editor).toHaveAttribute('data-max-width', CELL_EDITOR_MAX_WIDTH);
    expect(editor).toHaveAttribute('data-max-height', CELL_EDITOR_MAX_HEIGHT);
    expect(editor).toHaveAttribute('data-visible-lines', '8');
    expect(editor).toHaveStyle({
      maxHeight: CELL_EDITOR_MAX_HEIGHT,
      maxWidth: CELL_EDITOR_MAX_WIDTH,
      overflow: 'auto',
    });
  });
});
