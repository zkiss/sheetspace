import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument } from '@test-support/workbookFactories';
import { NumberFormatControls } from './NumberFormatControls';

const sheet = sheetDocument({ id: 'format-controls', name: 'Format controls', rowCount: 1, columnCount: 2 });
const rowId = sheet.content.rows[0]!;
const firstColumnId = sheet.content.columns[0]!;
const secondColumnId = sheet.content.columns[1]!;
const selection = {
  mode: 'cells' as const,
  anchor: { sheetId: sheet.id, cell: { rowId, columnId: firstColumnId } },
  extent: { sheetId: sheet.id, cell: { rowId, columnId: firstColumnId } },
};

describe('NumberFormatControls rendering', () => {
  it('writes selected formats, bounded precision, inheritance, and reset through its callback', async () => {
    const user = userEvent.setup();
    const onWrite = vi.fn();
    const targetId = cellIdentityKey({ rowId, columnId: firstColumnId });
    const formattedSheet = {
      ...sheet,
      presentation: {
        ...sheet.presentation,
        formatOverrides: { rows: {}, columns: {}, cells: { [targetId]: { numberFormat: { kind: 'percent' as const, precision: 1 } } } },
      },
    };
    render(<NumberFormatControls sheet={formattedSheet} selection={selection} onWrite={onWrite} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Number format' }), 'number');
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, numberFormat: { kind: 'number', precision: 0 } }]);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Number format' }), 'general');
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, numberFormat: { kind: 'general' } }]);

    const precision = screen.getByRole('spinbutton', { name: 'Number format precision' });
    fireEvent.change(precision, { target: { value: '1.5' } });
    expect(onWrite).toHaveBeenCalledTimes(2);
    fireEvent.change(precision, { target: { value: '99' } });
    expect(onWrite).toHaveBeenCalledTimes(2);
    fireEvent.change(precision, { target: { value: '2' } });
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, numberFormat: { kind: 'percent', precision: 2 } }]);

    await user.click(screen.getByRole('button', { name: 'Inherit' }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, numberFormat: null }]);
    await user.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, numberFormat: { kind: 'general' } }]);
  });

  it('shows mixed state and disables controls when selection cannot be formatted', () => {
    const targetId = cellIdentityKey({ rowId, columnId: firstColumnId });
    const otherTargetId = cellIdentityKey({ rowId, columnId: secondColumnId });
    const mixedSelection = { ...selection, extent: { sheetId: sheet.id, cell: { rowId, columnId: secondColumnId } } };
    const mixedSheet = {
      ...sheet,
      presentation: {
        ...sheet.presentation,
        formatOverrides: {
          rows: {}, columns: {}, cells: {
            [targetId]: { numberFormat: { kind: 'number' as const, precision: 1 } },
            [otherTargetId]: { numberFormat: { kind: 'percent' as const, precision: 1 } },
          },
        },
      },
    };
    const { rerender } = render(<NumberFormatControls sheet={mixedSheet} selection={mixedSelection} onWrite={vi.fn()} />);
    expect(screen.getByRole('option', { name: 'Mixed' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Number format precision' })).toBeDisabled();

    rerender(<NumberFormatControls sheet={sheet} selection={null} onWrite={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Number format' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
  });
});
