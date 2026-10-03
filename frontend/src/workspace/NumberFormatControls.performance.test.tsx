import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as identity from '@workbook/core/cellIdentity';
import * as sparse from '@workbook/read/formattingSummarySparse';
import { sheetDocument } from '@test-support/workbookFactories';
import { NumberFormatControls } from './NumberFormatControls.testHarness';

afterEach(() => vi.restoreAllMocks());

it('avoids write-target allocation for validity and reuses summaries through frame previews and saves', () => {
  const sheet = sheetDocument({ id: 'format', name: 'Format', rowCount: 20, columnCount: 20 });
  const selection = { mode: 'cells' as const,
    anchor: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } },
    extent: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[19]!, columnId: sheet.content.columns[19]! } },
  };
  const keys = vi.spyOn(identity, 'cellIdentityKey');
  const summarize = vi.spyOn(sparse, 'summarizeFormattingSparse');
  const oldWrite = vi.fn();
  const latestWrite = vi.fn();
  const view = render(<NumberFormatControls sheet={sheet} selection={selection} onWrite={oldWrite} />);
  // The shared sparse projection constructs no cell keys; writes remain
  // output-linear and are the only source of keys after a memo hit.
  expect(keys).not.toHaveBeenCalled();
  expect(summarize).toHaveBeenCalledOnce();
  summarize.mockClear();
  keys.mockClear();
  for (let x = 1; x <= 5; x++) view.rerender(<NumberFormatControls
    sheet={{ ...sheet, revision: x, frame: { ...sheet.frame, position: { x, y: 0 } } }} selection={selection} onWrite={latestWrite} />);
  view.rerender(<NumberFormatControls sheet={{ ...sheet, content: { ...sheet.content, cells: { edited: 'value-only change' } } }}
    selection={{ ...selection, anchor: { ...selection.anchor, cell: { ...selection.anchor.cell } } }} onWrite={latestWrite} />);
  expect(keys).not.toHaveBeenCalled();
  expect(summarize).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Number format' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Number format' }));
  expect(oldWrite).not.toHaveBeenCalled();
  expect(latestWrite).toHaveBeenCalledOnce();
  expect(latestWrite.mock.calls[0]![0]).toHaveLength(400);
  expect(keys).toHaveBeenCalledTimes(400);
  keys.mockClear();
  fireEvent.click(screen.getByRole('button', { name: /Bold:/ }));
  expect(oldWrite).not.toHaveBeenCalled();
  expect(latestWrite).toHaveBeenCalledTimes(2);
  expect(latestWrite.mock.calls[1]![0]).toHaveLength(400);
  expect(keys).toHaveBeenCalledTimes(400);
  expect(summarize).not.toHaveBeenCalled();
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
