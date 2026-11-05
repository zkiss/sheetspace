import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCellEditing } from '@grid/useCellEditing';
import { cellTargetAt } from '@grid/cellInteraction';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { formattingSelection } from '@test-support/formattingProjection';
import { formattingWorkspaceProps } from '@test-support/formattingWorkspace';
import { Workspace } from './Workspace';

it.each(['successor', 'unmount'] as const)('does not restore a palette binding after %s', async (scenario) => {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
  const model = { id: 'model', name: 'Model', columns: [{ id: 'property', name: 'Amount', kind: 'manual' as const, type: 'float' as const }] };
  const before = { ...workbookWithSheets([sheet]), dataModels: { model } };
  const after = { ...before, documents: { ...before.documents, [sheet.id]: { ...sheet, content: { ...sheet.content, rows: [] } } } };
  let current = before;
  let publish!: (before: typeof current, after: typeof current) => void;
  let finish!: (result: { ok: false; reason: 'persistence-failed' }) => void;
  let editing!: ReturnType<typeof useCellEditing>;
  const restore = vi.fn();
  const props = formattingWorkspaceProps(sheet, formattingSelection(sheet, 'cells'));
  const commands = { ...props.commands, currentWorkbook: () => current, bindSheetToModel: vi.fn((_sheet, _model, observer) => {
    publish = observer!;
    current = after;
    publish(before, after);
    return { result: { ok: true as const, value: after }, completion: new Promise<{ ok: false; reason: 'persistence-failed' }>((resolve) => { finish = resolve; }) };
  }) };
  function Harness() {
    editing = useCellEditing({ commands, workbook: before, currentWorkbook: () => current });
    return <Workspace {...props} workbook={before} commands={commands} activeCell={editing.selectionRange?.anchor ?? null} selectionRange={editing.selectionRange}
      selectionSettlement={editing} onRestoreSelection={(selection) => { restore(selection); return editing.restoreSelection(selection); }} />;
  }
  const view = render(<Harness />);
  act(() => editing.selectCell(cellTargetAt(sheet, 'A1')!));
  fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bind model…' }));
  const panel = screen.getByRole('dialog');
  fireEvent.change(within(panel).getByRole('combobox'), { target: { value: 'model' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Bind model' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm bind' }));
  expect(commands.bindSheetToModel).toHaveBeenCalledOnce();
  const successor = scenario === 'successor' ? editing.beginSelectionSettlement() : undefined;
  if (scenario === 'unmount') view.unmount();
  await act(async () => { current = before; publish(after, before); finish({ ok: false, reason: 'persistence-failed' }); });
  expect(restore).not.toHaveBeenCalled();
  if (successor) expect(editing.ownsSelectionSettlement(successor)).toBe(true);
});
