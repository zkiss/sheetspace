import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as identity from '@workbook/core/cellIdentity';
import { sheetDocument } from '@test-support/workbookFactories';
import { NumberFormatControls } from './NumberFormatControls';

afterEach(() => vi.restoreAllMocks());

it('avoids write-target allocation for validity and reuses summaries through frame previews and saves', () => {
  const sheet = sheetDocument({ id: 'format', name: 'Format', rowCount: 20, columnCount: 20 });
  const selection = { mode: 'cells' as const,
    anchor: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } },
    extent: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[19]!, columnId: sheet.content.columns[19]! } },
  };
  const keys = vi.spyOn(identity, 'cellIdentityKey');
  const oldWrite = vi.fn();
  const latestWrite = vi.fn();
  const view = render(<NumberFormatControls sheet={sheet} selection={selection} onWrite={oldWrite} />);
  // Two existing local-target passes plus five effective-property passes.
  expect(keys).toHaveBeenCalledTimes(7 * 400);
  keys.mockClear();
  for (let x = 1; x <= 5; x++) view.rerender(<NumberFormatControls
    sheet={{ ...sheet, revision: x, frame: { ...sheet.frame, position: { x, y: 0 } } }} selection={selection} onWrite={latestWrite} />);
  expect(keys).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Number format' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Number format' }));
  expect(oldWrite).not.toHaveBeenCalled();
  expect(latestWrite).toHaveBeenCalledOnce();
  expect(latestWrite.mock.calls[0]![0]).toHaveLength(400);
  expect(keys).toHaveBeenCalledTimes(400);
});

it('invalidates summaries on overrides, selection, axes and sheet identity, including custom palette colours', () => {
  const sheet = sheetDocument({ id: 'format', name: 'Format', rowCount: 1, columnCount: 2 });
  const target = { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } };
  const selection = { mode: 'cells' as const, anchor: target, extent: target };
  const onWrite = vi.fn();
  const view = render(<NumberFormatControls sheet={sheet} selection={selection} onWrite={onWrite} />);
  const styled = { ...sheet, presentation: { ...sheet.presentation, formatOverrides: { rows: {}, columns: {}, cells: {
    [identity.cellIdentityKey(target.cell)]: { numberFormat: { kind: 'percent' as const, precision: 3 }, textColor: '#abcdef' as const, fontWeight: 'bold' as const },
  } } } };
  view.rerender(<NumberFormatControls sheet={styled} selection={selection} onWrite={onWrite} />);
  expect(screen.getByRole('button', { name: 'Percent format' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('spinbutton')).toHaveValue(3);
  expect(screen.getByRole('button', { name: /Bold:.*explicit/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Text colour: #abcdef' }));
  expect(screen.getByRole('button', { name: 'Use #abcdef' })).toBeInTheDocument();
  const second = { ...target, cell: { ...target.cell, columnId: sheet.content.columns[1]! } };
  view.rerender(<NumberFormatControls sheet={styled} selection={{ ...selection, anchor: second, extent: second }} onWrite={onWrite} />);
  expect(screen.getByRole('button', { name: 'General number format' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /Bold:.*inherited/ })).toHaveAttribute('aria-pressed', 'false');
  view.rerender(<NumberFormatControls sheet={{ ...styled, content: { ...sheet.content, columns: [second.cell.columnId] } }} selection={selection} onWrite={onWrite} />);
  expect(screen.getByRole('button', { name: 'Number format' })).toBeDisabled();
  view.rerender(<NumberFormatControls sheet={{ ...styled, id: 'another' }} selection={selection} onWrite={onWrite} />);
  expect(screen.getByRole('button', { name: 'Number format' })).toBeDisabled();
});
