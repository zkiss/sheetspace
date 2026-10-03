import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { AppearancePatch } from '@workbook/core/model';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { formattingSelection, observeFormattingProjection } from '@test-support/formattingProjection';
import { Workspace } from './Workspace';
import { formattingCommands, formattingWorkspaceProps } from '@test-support/formattingWorkspace';

afterEach(() => vi.restoreAllMocks());

describe('shared Workspace formatting wiring', () => {
  it('routes each formatting shortcut to the command and restores focus without recomputing the shared projection', () => {
    const sheet = smallSheetDocument({ id: 'keys', name: 'Keys', rowCount: 4, columnCount: 4 });
    const selection = formattingSelection(sheet, 'cells');
    const props = formattingWorkspaceProps(sheet, selection);
    const work = observeFormattingProjection();
    render(<Workspace {...props} />);
    work.expectCalls(1, 1, 1);
    work.clear();
    const cases: { key: string; code?: string; properties: AppearancePatch }[] = [
      { key: 'b', properties: { fontWeight: 'bold' } },
      { key: '!', code: 'Digit1', properties: { numberFormat: { kind: 'number', precision: 2 } } },
      { key: '%', code: 'Digit5', properties: { numberFormat: { kind: 'percent', precision: 0 } } },
      { key: ')', code: 'Digit0', properties: { numberFormat: { kind: 'general' } } },
      { key: 'e', properties: { horizontalAlignment: 'center' } },
      { key: 'l', properties: { horizontalAlignment: 'left' } },
      { key: 'r', properties: { horizontalAlignment: 'right' } },
    ];
    for (const [index, { key, code, properties }] of cases.entries()) {
      expect(fireEvent.keyDown(document.body, { key, code, ctrlKey: true, shiftKey: key !== 'b' })).toBe(false);
      expect(props.commands.writeNumberFormats).toHaveBeenCalledTimes(index + 1);
      expect(props.commands.writeNumberFormats).toHaveBeenLastCalledWith(sheet.id,
        sheet.content.rows.slice(0, 3).flatMap((rowId) => sheet.content.columns.slice(0, 3).map((columnId) => ({
          scope: 'cell', targetId: cellIdentityKey({ rowId, columnId }), properties,
        }))));
      expect(props.onRestoreGridFocus).toHaveBeenCalledTimes(index + 1);
      work.expectCalls(0, 0, 0);
    }
  });

  it('uses replacement commands and focus callbacks for keyboard and toolbar across a memo hit and subsequent axis reorder', () => {
    const base = smallSheetDocument({ id: 'latest', name: 'Latest', rowCount: 4, columnCount: 4 });
    const sheet = { ...base, presentation: { ...base.presentation, formatOverrides: {
      rows: Object.fromEntries(base.content.rows.map((id) => [id, { numberFormat: { kind: 'number' as const, precision: 4 }, fontWeight: 'bold' as const }])),
      columns: {}, cells: {},
    } } };
    const selection = formattingSelection(sheet, 'rows');
    const initial = formattingWorkspaceProps(sheet, selection);
    const work = observeFormattingProjection();
    const view = render(<Workspace {...initial} />);
    work.expectCalls(1, 1, 1);
    work.clear();
    const latest = { ...initial, commands: formattingCommands(), onRestoreGridFocus: vi.fn(() => null),
      selectionRange: { ...selection, anchor: { ...selection.anchor, cell: { ...selection.anchor.cell } } },
    };
    view.rerender(<Workspace {...latest} />);
    fireEvent.keyDown(document.body, { key: 'b', metaKey: true });
    expect(latest.commands.writeNumberFormats).toHaveBeenLastCalledWith(sheet.id,
      sheet.content.rows.slice(0, 3).map((targetId) => ({ scope: 'row', targetId, properties: { fontWeight: 'normal' } })));
    fireEvent.click(screen.getByRole('button', { name: 'Number format' }));
    expect(latest.commands.writeNumberFormats).toHaveBeenLastCalledWith(sheet.id,
      sheet.content.rows.slice(0, 3).map((targetId) => ({ scope: 'row', targetId, properties: { numberFormat: { kind: 'number', precision: 4 } } })));
    work.expectCalls(0, 0, 0);
    const rows = [sheet.content.rows[0]!, sheet.content.rows[3]!, sheet.content.rows[1]!, sheet.content.rows[2]!];
    view.rerender(<Workspace {...latest} workbook={workbookWithSheets([{ ...sheet, content: { ...sheet.content, rows } }])} />);
    work.expectCalls(1, 1, 0);
    work.clear();
    fireEvent.keyDown(document.body, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Number format' }));
    expect(latest.commands.writeNumberFormats).toHaveBeenCalledTimes(4);
    for (const [, writes] of vi.mocked(latest.commands.writeNumberFormats).mock.calls.slice(2)) {
      expect(writes).toEqual(rows.map((targetId) => ({ scope: 'row', targetId, properties: { numberFormat: { kind: 'number', precision: 4 } } })));
    }
    expect(latest.onRestoreGridFocus).toHaveBeenCalledTimes(4);
    expect(initial.commands.writeNumberFormats).not.toHaveBeenCalled();
    expect(initial.onRestoreGridFocus).not.toHaveBeenCalled();
    work.expectCalls(0, 0, 0);
  });

  it('disables the toolbar and does not dispatch stale keyboard writes when an opposite-axis endpoint is removed or selection clears', () => {
    const sheet = smallSheetDocument({ id: 'invalid', name: 'Invalid', rowCount: 4, columnCount: 4 });
    const props = formattingWorkspaceProps(sheet, formattingSelection(sheet, 'rows'));
    const work = observeFormattingProjection();
    const view = render(<Workspace {...props} />);
    view.rerender(<Workspace {...props} workbook={workbookWithSheets([{ ...sheet, content: { ...sheet.content, columns: sheet.content.columns.slice(0, 2) } }])} />);
    work.clear();
    expect(screen.getByRole('button', { name: 'Number format' })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
    work.expectCalls(0, 0, 0);
    view.rerender(<Workspace {...props} selectionRange={null} />);
    work.clear();
    fireEvent.keyDown(document.body, { key: ')', code: 'Digit0', ctrlKey: true, shiftKey: true });
    work.expectCalls(0, 0, 0);
    expect(props.commands.writeNumberFormats).not.toHaveBeenCalled();
    expect(props.onRestoreGridFocus).not.toHaveBeenCalled();
  });
});
