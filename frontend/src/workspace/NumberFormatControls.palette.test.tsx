import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { NumberFormatControls } from './NumberFormatControls';
import { cellIdentityKey } from '@workbook/core/cellIdentity';

function scenario() {
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 1, columnCount: 1 });
  const selection = { mode: 'cells' as const,
    anchor: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0], columnId: sheet.content.columns[0] } },
    extent: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0], columnId: sheet.content.columns[0] } },
  };
  return { sheet, selection };
}

describe('compact colour palettes', () => {
  it('distinguishes explicit no-colour defaults from inherited values and selects built-in swatches', () => {
    const { sheet, selection } = scenario();
    const targetId = cellIdentityKey(selection.anchor.cell);
    const onWrite = vi.fn();
    const styled = { ...sheet, presentation: { ...sheet.presentation, formatOverrides: {
      rows: {}, columns: {}, cells: { [targetId]: { textColor: 'automatic' as const, fillColor: 'none' as const } },
    } } };
    const { rerender } = render(<NumberFormatControls sheet={styled} selection={selection} onWrite={onWrite} />);
    for (const label of ['Text colour', 'Fill colour']) {
      const trigger = screen.getByRole('button', { name: `${label}: no colour` });
      expect(trigger).toHaveAttribute('data-colour-mode', 'none');
      fireEvent.click(trigger);
      expect(screen.getByRole('button', { name: 'No colour' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Inherit' })).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(screen.getByRole('button', { name: 'Use #23855d' }));
      expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId, properties: { [label === 'Text colour' ? 'textColor' : 'fillColor']: '#23855d' } }]);
    }
    rerender(<NumberFormatControls sheet={{ ...styled, presentation: { ...sheet.presentation, formatOverrides: { rows: {}, columns: {}, cells: { [targetId]: { textColor: '#23855d' } } } } }} selection={selection} onWrite={onWrite} />);
    fireEvent.click(screen.getByRole('button', { name: 'Text colour: #23855d' }));
    expect(screen.getByRole('button', { name: 'Use #23855d' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('previews custom input without writing, then applies once and restores focus on Escape', () => {
    const { sheet, selection } = scenario();
    const onWrite = vi.fn();
    render(<NumberFormatControls sheet={sheet} selection={selection} onWrite={onWrite} />);
    const trigger = screen.getByRole('button', { name: 'Text colour: inherited' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Add custom colour' }));
    fireEvent.input(screen.getByLabelText('Custom colour'), { target: { value: '#abcdef' } });
    expect(onWrite).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('data-colour-mode', 'colour');
    fireEvent.click(screen.getByRole('button', { name: 'Use #abcdef' }));
    expect(onWrite).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inherit' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('data-colour-mode', 'inherited');
  });

  it('dismisses on outside click after a cancelled native custom picker and cannot write after selection becomes invalid', () => {
    const { sheet, selection } = scenario();
    const onWrite = vi.fn();
    const { rerender } = render(<NumberFormatControls sheet={sheet} selection={selection} onWrite={onWrite} />);
    const trigger = screen.getByRole('button', { name: 'Fill colour: inherited' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Add custom colour' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    rerender(<NumberFormatControls sheet={sheet} selection={{ ...selection, extent: { ...selection.extent, sheetId: 'missing' } }} onWrite={onWrite} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('deduplicates sheet colours case-insensitively and never duplicates a draft palette swatch', () => {
    const { sheet, selection } = scenario();
    const styled = { ...sheet, presentation: { ...sheet.presentation, formatOverrides: {
      cells: {}, rows: { [sheet.content.rows[0]]: { textColor: '#ABCDEF' as const } },
      columns: { [sheet.content.columns[0]]: { fillColor: '#abcdef' as const, textColor: '#1F2933' as const } },
    } } };
    render(<NumberFormatControls sheet={styled} selection={selection} onWrite={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Text colour: inherited' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('button', { name: 'Use #abcdef' })).toHaveLength(1);
    expect(within(dialog).getAllByRole('button', { name: 'Use #1f2933' })).toHaveLength(1);
    fireEvent.input(screen.getByLabelText('Custom colour'), { target: { value: '#abcdef' } });
    expect(within(dialog).getAllByRole('button', { name: 'Use #abcdef' })).toHaveLength(1);
  });
});
