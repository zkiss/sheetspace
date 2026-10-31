import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

describe('open ranges on model record admission', () => {
  it('excludes draft values and recalculates after submitting the record', async () => {
    const source = { ...sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '4' } }), modelId: 'model', modelColumnBindings: { amount: 'source:column:1' } };
    const model = { id: 'model', name: 'Model', columns: [{ id: 'amount', name: 'Amount', kind: 'manual' as const, type: 'float' as const }] };
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1 });
    const initial = { ...workbookWithSheets([source, output]), dataModels: { model } };
    const formula = prepareUserFormula('=SUM(@Source!Amount[1]:Amount)', initial, output.id);
    const target = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1, cells: { A1: formula } });
    const workbook = { ...workbookWithSheets([source, target]), dataModels: { model } };
    const observer = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, calculationObserver: observer }));

    act(() => result.current.commands.changeEntryField(source.id, 'amount', '7'));
    expect(result.current.formulaResults.output.A1).toMatchObject({ value: 4 });
    expect(result.current.workbook.documents.source.content.rows).toHaveLength(1);
    observer.mockClear();

    let submission: Awaited<ReturnType<typeof result.current.commands.submitEntryDraft>>;
    await act(async () => { submission = await result.current.commands.submitEntryDraft(source.id); });

    expect(submission!.result).toBeDefined();
    expect(result.current.workbook.documents.source.content.rows).toHaveLength(2);
    expect(observer).toHaveBeenCalledWith({ kind: 'structure' });
    expect(result.current.formulaResults.output.A1).toMatchObject({ value: 11 });
  });
});
