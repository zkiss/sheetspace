import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument } from '@test-support/workbookFactories';
import { NumberFormatControls } from './NumberFormatControls';
import { applyCustomColour } from '@test-support/workspaceActions';

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

    await user.click(screen.getByRole('button', { name: 'Number format' }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { numberFormat: { kind: 'number', precision: 2 } } }]);

    await user.click(screen.getByRole('button', { name: 'General number format' }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { numberFormat: { kind: 'general' } } }]);

    const precision = screen.getByRole('spinbutton', { name: 'Number format precision' });
    fireEvent.change(precision, { target: { value: '1.5' } });
    expect(onWrite).toHaveBeenCalledTimes(2);
    fireEvent.change(precision, { target: { value: '99' } });
    expect(onWrite).toHaveBeenCalledTimes(2);
    fireEvent.change(precision, { target: { value: '2' } });
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { numberFormat: { kind: 'percent', precision: 2 } } }]);

    await user.click(screen.getByRole('button', { name: 'Inherit number format' }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { numberFormat: null } }]);
    await user.click(screen.getByRole('button', { name: 'General number format' }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { numberFormat: { kind: 'general' } } }]);
  });

  it('preserves the current percent precision when its compact button is reapplied', () => {
    const targetId = cellIdentityKey(selection.anchor.cell);
    const onWrite = vi.fn();
    const styled = { ...sheet, presentation: { ...sheet.presentation, formatOverrides: { rows: {}, columns: {}, cells: { [targetId]: { numberFormat: { kind: 'percent' as const, precision: 3 } } } } } };
    render(<NumberFormatControls sheet={styled} selection={selection} onWrite={onWrite} />);
    fireEvent.click(screen.getByRole('button', { name: 'Percent format' }));
    expect(onWrite).toHaveBeenCalledWith([{ scope: 'cell', targetId, properties: { numberFormat: { kind: 'percent', precision: 3 } } }]);
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
    for (const name of ['General number format', 'Number format', 'Percent format']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(screen.getByRole('spinbutton', { name: 'Number format precision' })).toBeDisabled();

    rerender(<NumberFormatControls sheet={sheet} selection={null} onWrite={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Number format' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'General number format' })).toBeDisabled();
  });

  it('defaults Percent to zero decimal places when changing from General', async () => {
    const user = userEvent.setup();
    const onWrite = vi.fn();
    const targetId = cellIdentityKey({ rowId, columnId: firstColumnId });
    render(<NumberFormatControls sheet={sheet} selection={selection} onWrite={onWrite} />);

    await user.click(screen.getByRole('button', { name: 'Percent format' }));

    expect(onWrite).toHaveBeenCalledWith([{ scope: 'cell', targetId, properties: { numberFormat: { kind: 'percent', precision: 0 } } }]);
  });

  it('does not write while a precision edit is empty', () => {
    const onWrite = vi.fn();
    const targetId = cellIdentityKey({ rowId, columnId: firstColumnId });
    const formattedSheet = {
      ...sheet,
      presentation: {
        ...sheet.presentation,
        formatOverrides: { rows: {}, columns: {}, cells: { [targetId]: { numberFormat: { kind: 'number' as const, precision: 2 } } } },
      },
    };
    render(<NumberFormatControls sheet={formattedSheet} selection={selection} onWrite={onWrite} />);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Number format precision' }), { target: { value: '' } });

    expect(onWrite).not.toHaveBeenCalled();
  });

  it('makes mixed effective and local appearance state visible while preserving writes', () => {
    const onWrite = vi.fn();
    const first = cellIdentityKey({ rowId, columnId: firstColumnId });
    const second = cellIdentityKey({ rowId, columnId: secondColumnId });
    const styled = {
      ...sheet, presentation: { ...sheet.presentation, formatOverrides: {
        rows: { [rowId]: { fontWeight: 'normal' as const } }, columns: {}, cells: {
          [first]: { fontWeight: 'normal' as const, horizontalAlignment: 'general' as const, textColor: '#ff0000' as const, fillColor: '#00ff00' as const },
          [second]: { textColor: '#0000ff' as const, fillColor: '#ffffff' as const },
        },
      } },
    };
    render(<NumberFormatControls sheet={styled} selection={{ ...selection, extent: { sheetId: sheet.id, cell: { rowId, columnId: secondColumnId } } }} onWrite={onWrite} />);

    expect(screen.getByRole('button', { name: /Bold: one effective value; mixed local overrides/ })).toHaveAttribute('data-mixed', 'true');
    expect(screen.getByText('Bold: one effective value; mixed local overrides')).toBeVisible();
    expect(screen.getByText('Horizontal alignment: one effective value; mixed local overrides')).toBeVisible();
    expect(screen.getByLabelText('Horizontal alignment')).toHaveAttribute('data-mixed', 'true');
    expect(screen.getByText('Text colour: mixed effective values; mixed local overrides')).toBeInTheDocument();
    expect(screen.getByText('Fill colour: mixed effective values; mixed local overrides')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text colour: mixed' })).toHaveAttribute('data-mixed', 'true');
    applyCustomColour('Text colour', '#abcdef');
    expect(onWrite).toHaveBeenLastCalledWith([
      { scope: 'cell', targetId: first, properties: { textColor: '#abcdef' } },
      { scope: 'cell', targetId: second, properties: { textColor: '#abcdef' } },
    ]);
  });

  it('writes each explicit appearance default and keeps inherited colour values out of colour inputs', async () => {
    const user = userEvent.setup();
    const onWrite = vi.fn();
    const targetId = cellIdentityKey({ rowId, columnId: firstColumnId });
    const { rerender } = render(<NumberFormatControls sheet={sheet} selection={selection} onWrite={onWrite} />);

    await user.click(screen.getByRole('button', { name: /Bold: one effective value; inherited/ }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { fontWeight: 'bold' } }]);
    rerender(<NumberFormatControls sheet={{ ...sheet, presentation: { ...sheet.presentation, formatOverrides: { rows: {}, columns: {}, cells: { [targetId]: { fontWeight: 'bold' } } } } }} selection={selection} onWrite={onWrite} />);
    await user.click(screen.getByRole('button', { name: /Bold: one effective value; explicit/ }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { fontWeight: 'normal' } }]);
    await user.click(screen.getByRole('button', { name: 'Align center' }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { horizontalAlignment: 'center' } }]);
    await user.click(screen.getByRole('button', { name: 'Automatic alignment' }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { horizontalAlignment: 'general' } }]);
    await user.click(screen.getByRole('button', { name: 'Text colour: inherited' }));
    await user.click(screen.getByRole('button', { name: 'No colour' }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { textColor: 'automatic' } }]);
    await user.click(screen.getByRole('button', { name: 'Fill colour: inherited' }));
    await user.click(screen.getByRole('button', { name: 'No colour' }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { fillColor: 'none' } }]);
    expect(screen.getByRole('button', { name: 'Text colour: inherited' })).toHaveAttribute('data-colour-mode', 'inherited');
    expect(screen.getByRole('button', { name: 'Fill colour: inherited' })).toHaveAttribute('data-colour-mode', 'inherited');
  });

  it('shows explicit appearance values and removes each local override independently', async () => {
    const user = userEvent.setup();
    const onWrite = vi.fn();
    const targetId = cellIdentityKey({ rowId, columnId: firstColumnId });
    const styled = {
      ...sheet,
      presentation: {
        ...sheet.presentation,
        formatOverrides: {
          rows: {}, columns: {}, cells: {
            [targetId]: {
              fontWeight: 'bold' as const, horizontalAlignment: 'right' as const,
              textColor: '#123456' as const, fillColor: '#abcdef' as const,
            },
          },
        },
      },
    };
    render(<NumberFormatControls sheet={styled} selection={selection} onWrite={onWrite} />);

    expect(screen.getByRole('button', { name: 'Text colour: #123456' })).toHaveAttribute('data-colour-mode', 'colour');
    expect(screen.getByRole('button', { name: 'Fill colour: #abcdef' })).toHaveAttribute('data-colour-mode', 'colour');
    await user.click(screen.getByRole('button', { name: /Bold: one effective value; explicit/ }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { fontWeight: 'normal' } }]);
    for (const [name, properties] of [
      ['Inherit bold setting', { fontWeight: null }],
      ['Inherit horizontal alignment', { horizontalAlignment: null }],
    ] as const) {
      await user.click(screen.getByRole('button', { name }));
      expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties }]);
    }
    for (const label of ['Text colour', 'Fill colour'] as const) {
      await user.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
      await user.click(screen.getByRole('button', { name: 'Inherit' }));
      expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { [label === 'Text colour' ? 'textColor' : 'fillColor']: null } }]);
    }
  });
});
