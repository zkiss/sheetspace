import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { AppearancePatch, FormatWrite, NumberFormat, SheetDocument } from '@workbook/core/model';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { formattingModes, formattingSelection, observeFormattingProjection } from '@test-support/formattingProjection';
import { Workspace } from './Workspace';
import { formattingCommands, formattingWorkspaceProps } from '@test-support/formattingWorkspace';

afterEach(() => vi.restoreAllMocks());

function styledSheet(numberFormat: NumberFormat): SheetDocument {
  const sheet = smallSheetDocument({ id: 'actions', name: 'Actions', rowCount: 4, columnCount: 4 });
  const appearance = { numberFormat, fontWeight: 'bold' as const };
  return { ...sheet, presentation: { ...sheet.presentation, formatOverrides: {
    rows: Object.fromEntries(sheet.content.rows.map((id) => [id, appearance])),
    columns: Object.fromEntries(sheet.content.columns.map((id) => [id, appearance])), cells: {},
  } } };
}

// Independent expected write scopes/IDs; do not invoke the production writer or validator.
function expectedWrites(sheet: SheetDocument, mode: typeof formattingModes[number], properties: AppearancePatch): FormatWrite[] {
  const rows = sheet.content.rows;
  const columns = sheet.content.columns;
  if (mode === 'rows') return rows.map((targetId) => ({ scope: 'row', targetId, properties }));
  if (mode === 'columns') return columns.map((targetId) => ({ scope: 'column', targetId, properties }));
  return rows.flatMap((rowId) => columns.map((columnId) => ({
    scope: 'cell' as const, targetId: cellIdentityKey({ rowId, columnId }), properties,
  })));
}

describe.each(formattingModes)('%s shared Workspace formatting actions', (mode) => {
  it.each(['number', 'percent'] as const)('uses cached %s precision and replacement commands for toolbar and keyboard after axis reorder', (kind) => {
    const sheet = styledSheet({ kind, precision: 4 });
    const selection = formattingSelection(sheet, mode);
    const initial = formattingWorkspaceProps(sheet, selection);
    const work = observeFormattingProjection();
    const view = render(<Workspace {...initial} />);
    // Workspace and its real toolbar share one projection, not one each.
    work.expectCalls(1, 1, 1);
    work.clear();
    const commands = formattingCommands();
    const restore = vi.fn(() => null);
    const latest = { ...initial, commands, onRestoreGridFocus: restore,
      selectionRange: { ...selection, anchor: { ...selection.anchor, cell: { ...selection.anchor.cell } } },
    };
    view.rerender(<Workspace {...latest} />);
    work.expectCalls(0, 0, 0);
    const shortcut = (key: string, code?: string) => fireEvent.keyDown(document.body, {
      key, code, ctrlKey: true, shiftKey: key !== 'b',
    });
    // Dispatch immediately after a callback-only hit, before any invalidation.
    shortcut('b');
    const originalTargets = { ...sheet, content: { ...sheet.content,
      rows: sheet.content.rows.slice(0, 3), columns: sheet.content.columns.slice(0, 3),
    } };
    expect(commands.writeNumberFormats).toHaveBeenLastCalledWith(sheet.id, expectedWrites(originalTargets, mode, { fontWeight: 'normal' }));
    expect(restore).toHaveBeenCalledOnce();
    work.expectCalls(0, 0, 0);
    vi.mocked(commands.writeNumberFormats).mockClear();
    restore.mockClear();
    // Stable endpoints now surround an extra interior ID on both axes: W grows
    // from 9 to 16 for cells and from 3 to 4 for axis scopes.
    const reorder = (ids: readonly string[]) => [ids[0]!, ids[3]!, ids[1]!, ids[2]!];
    const reordered = { ...sheet, content: { ...sheet.content,
      rows: reorder(sheet.content.rows), columns: reorder(sheet.content.columns),
    } };
    view.rerender(<Workspace {...latest} workbook={workbookWithSheets([reordered])} />);
    work.expectCalls(1, 1, 0);
    work.clear();
    const actions: { run: () => void; properties: AppearancePatch }[] = [
      { run: () => shortcut('b'), properties: { fontWeight: 'normal' } },
      { run: () => shortcut('!', 'Digit1'), properties: { numberFormat: { kind: 'number', precision: kind === 'number' ? 4 : 2 } } },
      { run: () => shortcut('%', 'Digit5'), properties: { numberFormat: { kind: 'percent', precision: kind === 'percent' ? 4 : 0 } } },
      { run: () => shortcut(')', 'Digit0'), properties: { numberFormat: { kind: 'general' } } },
      ...([['e', 'center'], ['l', 'left'], ['r', 'right']] as const).map(([key, alignment]) => ({
        run: () => shortcut(key), properties: { horizontalAlignment: alignment },
      })),
      { run: () => fireEvent.click(screen.getByRole('button', { name: /Bold:/ })), properties: { fontWeight: 'normal' } },
      { run: () => fireEvent.click(screen.getByRole('button', { name: kind === 'number' ? 'Number format' : 'Percent format' })), properties: { numberFormat: { kind, precision: 4 } } },
      { run: () => fireEvent.click(screen.getByRole('button', { name: 'General number format' })), properties: { numberFormat: { kind: 'general' } } },
      { run: () => fireEvent.click(screen.getByRole('button', { name: 'Align center' })), properties: { horizontalAlignment: 'center' } },
    ];
    actions.forEach(({ run, properties }, index) => {
      run();
      expect(commands.writeNumberFormats).toHaveBeenCalledTimes(index + 1);
      expect(commands.writeNumberFormats).toHaveBeenLastCalledWith(sheet.id, expectedWrites(reordered, mode, properties));
      expect(restore).toHaveBeenCalledTimes(index + 1);
      work.expectCalls(0, 0, 0);
    });
    expect(initial.commands.writeNumberFormats).not.toHaveBeenCalled();
    expect(initial.onRestoreGridFocus).not.toHaveBeenCalled();
  });

  it('does not dispatch empty or stale writes for removed/opposite-axis endpoints and cleared selections', () => {
    const sheet = styledSheet({ kind: 'number', precision: 3 });
    const selection = formattingSelection(sheet, mode);
    const props = formattingWorkspaceProps(sheet, selection);
    const work = observeFormattingProjection();
    const view = render(<Workspace {...props} />);
    for (const axis of ['rows', 'columns'] as const) {
      const removed = { ...sheet, content: { ...sheet.content, [axis]: sheet.content[axis].slice(0, 2) } };
      view.rerender(<Workspace {...props} workbook={workbookWithSheets([removed])} />);
      work.clear();
      expect(screen.getByRole('button', { name: 'Number format' })).toBeDisabled();
      for (const [key, code] of [['b', 'KeyB'], ['!', 'Digit1'], ['%', 'Digit5'], [')', 'Digit0'], ['e', 'KeyE']]) {
        fireEvent.keyDown(document.body, { key, code, ctrlKey: true, shiftKey: key !== 'b' });
      }
      work.expectCalls(0, 0, 0);
      expect(props.commands.writeNumberFormats).not.toHaveBeenCalled();
      expect(props.onRestoreGridFocus).not.toHaveBeenCalled();
    }
    view.rerender(<Workspace {...props} selectionRange={null} />);
    work.clear();
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: ')', code: 'Digit0', ctrlKey: true, shiftKey: true });
    work.expectCalls(0, 0, 0);
    expect(props.commands.writeNumberFormats).not.toHaveBeenCalled();
    expect(props.onRestoreGridFocus).not.toHaveBeenCalled();
  });
});
