import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { applyFormatWrites } from '@workbook/core/numberFormat';
import type { CellAppearance, SheetFormatOverrides } from '@workbook/core/model';
import { sheetDocument } from '@test-support/workbookFactories';
import { NumberFormatControls } from './NumberFormatControls';

function scenario(mode: 'rows' | 'columns') {
  const sheet = sheetDocument({ id: 'axis-colours', name: 'Colours', rowCount: 2, columnCount: 2 });
  const endpoint = (index: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[index]!, columnId: sheet.content.columns[index]! } });
  const selection = { mode, anchor: endpoint(1), extent: endpoint(0) };
  const ids = sheet.content[mode];
  const styled = (local: CellAppearance | undefined, cells: Record<string, CellAppearance> = {}) => ({
    ...sheet, presentation: { ...sheet.presentation, formatOverrides: {
      rows: {}, columns: {}, cells, [mode]: local ? Object.fromEntries(ids.map((id) => [id, local])) : {},
    } as SheetFormatOverrides },
  });
  const cellId = cellIdentityKey(endpoint(1).cell);
  return { sheet, selection, ids, styled, cellId };
}

describe.each(['rows', 'columns'] as const)('%s colour controls', (mode) => {
  it('shows axis swatches and pressed palette options despite cell exceptions, then refreshes after scoped writes', () => {
    const { selection, ids, styled, cellId } = scenario(mode);
    let sheet = styled({ textColor: '#23855d', fillColor: '#3267a8', fontWeight: 'bold' }, { [cellId]: { textColor: '#d84b4b', fillColor: '#c99c00' } });
    const onWrite = vi.fn();
    const { rerender } = render(<NumberFormatControls sheet={sheet} selection={selection} onWrite={onWrite} />);
    for (const [label, property, colour, defaultValue] of [
      ['Text colour', 'textColor', '#23855d', 'automatic'],
      ['Fill colour', 'fillColor', '#3267a8', 'none'],
    ] as const) {
      const trigger = screen.getByRole('button', { name: `${label}: ${colour}` });
      expect(trigger).toHaveAttribute('data-colour-mode', 'colour');
      expect(trigger).toHaveAttribute('data-local-override-state', 'explicit');
      expect(trigger).not.toHaveAttribute('data-mixed');
      expect(trigger.querySelector('.colour-picker-trigger-swatch')).toHaveStyle(`--colour-swatch: ${colour}`);
      expect(trigger).toHaveAccessibleDescription(`${label}: ${mode === 'rows' ? 'row' : 'column'}-level ${colour}; mixed effective values; explicit local override`);
      fireEvent.click(trigger);
      const palette = within(screen.getByRole('dialog', { name: label }));
      expect(palette.getByRole('button', { name: `Use ${colour}` })).toHaveAttribute('aria-pressed', 'true');
      expect(palette.getByRole('button', { name: 'Inherit' })).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(palette.getByRole('button', { name: 'No colour' }));
      const writes = ids.map((targetId) => ({ scope: mode === 'rows' ? 'row' as const : 'column' as const, targetId, properties: { [property]: defaultValue } }));
      expect(onWrite).toHaveBeenLastCalledWith(writes);
      sheet = { ...sheet, presentation: { ...sheet.presentation, formatOverrides: applyFormatWrites(sheet.presentation.formatOverrides, writes) } };
      rerender(<NumberFormatControls sheet={sheet} selection={selection} onWrite={onWrite} />);
      const defaultTrigger = screen.getByRole('button', { name: `${label}: no colour` });
      expect(defaultTrigger).toHaveAttribute('data-colour-mode', 'none');
      fireEvent.click(defaultTrigger);
      expect(screen.getByRole('button', { name: 'No colour' })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Inherit' }));
      const removals = writes.map((write) => ({ ...write, properties: { [property]: null } }));
      expect(onWrite).toHaveBeenLastCalledWith(removals);
      sheet = { ...sheet, presentation: { ...sheet.presentation, formatOverrides: applyFormatWrites(sheet.presentation.formatOverrides, removals) } };
      rerender(<NumberFormatControls sheet={sheet} selection={selection} onWrite={onWrite} />);
      const inheritedTrigger = screen.getByRole('button', { name: `${label}: inherited` });
      expect(inheritedTrigger).toHaveAttribute('data-local-override-state', 'inherited');
      fireEvent.click(inheritedTrigger);
      expect(screen.getByRole('button', { name: 'Inherit' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'No colour' })).toHaveAttribute('aria-pressed', 'false');
      fireEvent.keyDown(inheritedTrigger, { key: 'Escape' });
    }
    expect(sheet.presentation.formatOverrides?.cells[cellId]).toEqual({ textColor: '#d84b4b', fillColor: '#c99c00' });
    for (const id of ids) expect(sheet.presentation.formatOverrides?.[mode][id]).toEqual({ fontWeight: 'bold' });
  });

  it('shows Inherit, not constituent effective colours or mixtures, when the axes have no local colours', () => {
    const { selection, styled, cellId, sheet } = scenario(mode);
    const otherGroup = mode === 'rows' ? 'columns' : 'rows';
    const opposite = Object.fromEntries(sheet.content[otherGroup].map((id) => [id, { textColor: '#23855d', fillColor: '#3267a8' }]));
    const base = styled(undefined);
    const inherited = { ...base, presentation: { ...base.presentation, formatOverrides: { ...base.presentation.formatOverrides!, [otherGroup]: opposite } } };
    const { rerender } = render(<NumberFormatControls sheet={inherited} selection={selection} onWrite={vi.fn()} />);
    for (const exceptions of [{}, { [cellId]: { textColor: '#d84b4b' as const, fillColor: '#c99c00' as const } }]) {
      rerender(<NumberFormatControls sheet={{ ...inherited, presentation: { ...inherited.presentation, formatOverrides: { ...inherited.presentation.formatOverrides, cells: exceptions } } }} selection={selection} onWrite={vi.fn()} />);
      for (const label of ['Text colour', 'Fill colour']) {
        const trigger = screen.getByRole('button', { name: `${label}: inherited` });
        expect(trigger).toHaveAttribute('data-colour-mode', 'inherited');
        expect(trigger).not.toHaveAttribute('data-mixed');
        expect(trigger).toHaveAccessibleDescription(expect.stringContaining(`${mode === 'rows' ? 'row' : 'column'}-level inherited`));
        fireEvent.click(trigger);
        expect(screen.getByRole('button', { name: 'Inherit' })).toHaveAttribute('aria-pressed', 'true');
        for (const swatch of screen.getAllByRole('button', { name: /^Use / })) expect(swatch).not.toHaveAttribute('aria-pressed', 'true');
        fireEvent.keyDown(trigger, { key: 'Escape' });
      }
    }
  });

  it('shows mixed local settings even when cell overrides make all effective colours identical', () => {
    const { sheet, selection, ids, styled } = scenario(mode);
    const cells: Record<string, CellAppearance> = Object.fromEntries(sheet.content.rows.flatMap((rowId) => sheet.content.columns.map((columnId) => [cellIdentityKey({ rowId, columnId }), { textColor: '#23855d', fillColor: '#3267a8' }])));
    const base = styled(undefined, cells);
    render(<NumberFormatControls sheet={{ ...base, presentation: { ...base.presentation, formatOverrides: { ...base.presentation.formatOverrides!, [mode]: { [ids[0]!]: { textColor: '#23855d', fillColor: '#3267a8' } } } } }} selection={selection} onWrite={vi.fn()} />);
    for (const label of ['Text colour', 'Fill colour']) {
      const trigger = screen.getByRole('button', { name: `${label}: mixed` });
      expect(trigger).toHaveAttribute('data-mixed', 'true');
      expect(trigger).toHaveAttribute('data-local-override-state', 'mixed');
      expect(trigger).toHaveAccessibleDescription(`${label}: ${mode === 'rows' ? 'row' : 'column'}-level mixed; one effective value; mixed local overrides`);
      fireEvent.click(trigger);
      for (const option of within(screen.getByRole('dialog')).getAllByRole('button')) expect(option).not.toHaveAttribute('aria-pressed', 'true');
      fireEvent.keyDown(trigger, { key: 'Escape' });
    }
  });
});
