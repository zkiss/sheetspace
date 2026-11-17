import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWorkbookController } from './useWorkbookController';
import { useCellEditing } from '@grid/useCellEditing';
import { cellTargetAt } from '@grid/cellInteraction';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellRawContent } from '@workbook/read/queries';
import { decodeWorkbookBundle, encodeWorkbookBundle } from '@infrastructure/persistence/workbookApi';
import type { CellInputMode } from '@application/core/cellInputPreparation';

function editingHarness(initialWorkbook = workbookWithSheets([
  sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2 }),
])) {
  const hook = renderHook(() => {
    const controller = useWorkbookController({ initialWorkbook });
    return { controller, editing: useCellEditing({ commands: controller.commands, workbook: controller.workbook }) };
  });
  const target = (address = 'A1') => cellTargetAt(hook.result.current.controller.workbook.documents.sheet, address)!;
  const raw = () => cellRawContent(hook.result.current.controller.workbook.documents.sheet, 'A1') ?? '';
  const open = () => act(() => hook.result.current.editing.startEditingCell(target()));
  const draft = (value: string, mode?: CellInputMode) => {
    act(() => hook.result.current.editing.updateEditingCellValue(value));
    if (mode) act(() => hook.result.current.editing.updateEditingCellMode(mode));
  };
  const commit = (way: 'apply' | 'enter' | 'tab') => act(() => {
    const editing = hook.result.current.editing;
    if (way === 'apply') editing.commitActiveEdit();
    else editing.commitEditAndNavigate(editing.editingCell!, way);
  });
  const reload = () => decodeWorkbookBundle(JSON.parse(JSON.stringify(encodeWorkbookBundle(hook.result.current.controller.workbook))));
  return { ...hook, target, raw, open, draft, commit, reload };
}

describe('temporal editing through the controller', () => {
  it.each(['hello', '03/04/2026'])('round trips Auto and Text provenance for %s via Apply and Tab', (value) => {
    const h = editingHarness();
    h.open(); h.draft(value); h.commit('apply');
    expect(h.raw()).toBe(value);
    h.open();
    expect(h.result.current.editing.editingCell).toMatchObject({ draft: value, mode: 'auto' });
    act(() => h.result.current.editing.updateEditingCellMode('text'));
    h.commit('tab');
    expect(h.raw()).toBe(`"${value}"`);
    h.open();
    expect(h.result.current.editing.editingCell).toMatchObject({ draft: value, mode: 'text' });
    const textReload = editingHarness(h.reload());
    textReload.open();
    expect(textReload.result.current.editing.editingCell).toMatchObject({ draft: value, mode: 'text' });
    act(() => h.result.current.editing.updateEditingCellMode('auto'));
    h.commit('enter');
    expect(h.raw()).toBe(value);
    const reloaded = editingHarness(h.reload());
    reloaded.open();
    expect(reloaded.result.current.editing.editingCell).toMatchObject({ draft: value, mode: 'auto' });
  });

  it.each(['=1+2', '2024-02-29', '2023-02-29'])('retains literal Text %s after Enter and reload', (value) => {
    const h = editingHarness();
    h.open(); h.draft(value, 'text'); h.commit('enter');
    expect(h.raw()).toBe(`"${value}"`);
    const reloaded = editingHarness(h.reload());
    reloaded.open();
    expect(reloaded.result.current.editing.editingCell).toMatchObject({ draft: value, mode: 'text' });
    reloaded.commit('apply');
    expect(reloaded.raw()).toBe(`"${value}"`);
  });

  it('switches Text and Date without changing spelling and preserves datetime precision on reload', () => {
    const h = editingHarness();
    h.open(); h.draft('2024-02-29', 'text'); h.commit('apply');
    h.open(); act(() => h.result.current.editing.updateEditingCellMode('date')); h.commit('enter');
    expect(h.raw()).toBe('@date:2024-02-29');
    h.open(); act(() => h.result.current.editing.updateEditingCellMode('text')); h.commit('tab');
    expect(h.raw()).toBe('"2024-02-29"');
    h.open(); h.draft('2024-02-29 12:30:01.123400000', 'datetime'); h.commit('apply');
    expect(h.raw()).toBe('@datetime:2024-02-29 12:30:01.123400000');
    const reloaded = editingHarness(h.reload());
    reloaded.open();
    expect(reloaded.result.current.editing.editingCell).toMatchObject({ draft: '2024-02-29 12:30:01.123400000', mode: 'datetime' });
  });

  it('retains a real rejected draft through handoff, correction and cancellation', () => {
    const h = editingHarness();
    h.open(); h.draft('hello'); h.commit('apply');
    h.open(); h.draft('2023-02-29', 'date'); h.commit('enter');
    expect(h.raw()).toBe('hello');
    expect(h.result.current.editing.editingCell).toMatchObject({ draft: '2023-02-29', mode: 'date', validationMessage: expect.any(String) });
    act(() => h.result.current.editing.selectCell(h.target('B1')));
    h.open();
    expect(h.result.current.editing.editingCell).toMatchObject({ draft: '2023-02-29', mode: 'date', validationMessage: expect.any(String) });
    h.draft('2024-02-29'); h.commit('tab');
    expect(h.raw()).toBe('@date:2024-02-29');
    h.open(); h.draft('2024-02-29 12:30', 'datetime');
    act(() => h.result.current.editing.updateEditingCellMode('date'));
    h.commit('apply');
    expect(h.raw()).toBe('@date:2024-02-29');
    expect(h.result.current.editing.editingCell?.validationMessage).toEqual(expect.any(String));
    act(() => h.result.current.editing.cancelActiveEdit());
    h.open();
    expect(h.result.current.editing.editingCell).toMatchObject({ draft: '2024-02-29', mode: 'date' });
  });

  it('turns reopened Auto text into a formula and retains it through reload', () => {
    const h = editingHarness();
    h.open(); h.draft('hello'); h.commit('apply');
    h.open(); h.draft('=1+2'); h.commit('enter');
    expect(h.result.current.controller.formulaResults.sheet.A1).toMatchObject({ value: 3 });
    const raw = h.raw();
    const reloaded = editingHarness(h.reload());
    reloaded.open();
    expect(reloaded.result.current.editing.editingCell).toMatchObject({ draft: '=1+2', mode: 'auto' });
    reloaded.commit('apply');
    expect(reloaded.raw()).toBe(raw);
  });

  it('infers valid dates when switching Text to Auto and retains invalid automatic drafts', () => {
    const h = editingHarness();
    h.open(); h.draft('2024-02-29', 'text'); h.commit('apply');
    h.open(); act(() => h.result.current.editing.updateEditingCellMode('auto')); h.commit('enter');
    expect(h.raw()).toBe('@date:2024-02-29');
    h.open(); h.draft('2023-02-29', 'auto'); h.commit('tab');
    expect(h.raw()).toBe('@date:2024-02-29');
    expect(h.result.current.editing.editingCell).toMatchObject({ draft: '2023-02-29', mode: 'auto', validationMessage: expect.any(String) });
    act(() => h.result.current.editing.cancelActiveEdit());
    h.open();
    expect(h.result.current.editing.editingCell).toMatchObject({ draft: '2024-02-29', mode: 'date' });
  });
});
