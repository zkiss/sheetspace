import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSheet } from './workbook';
import { SheetGridCell } from './SheetGridCell';
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
});
