import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellTargetAt } from '@grid/cellInteraction';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { FormulaPanel } from './Workspace';

describe('FormulaPanel', () => {
  it('opens an empty rich draft for a blank editable cell', () => {
    const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs' });
    const target = cellTargetAt(sheet, 'A1')!;
    const onStart = vi.fn();
    const setOpen = vi.fn();
    render(<FormulaPanel activeCell={target} editingCell={null} formulaResults={{}} onCancel={vi.fn()} onCommit={vi.fn()} onRawChange={vi.fn()} onStart={onStart} open={false} selectedSheet={sheet} setOpen={setOpen} sheets={[sheet]} workbook={workbookWithSheets([sheet])} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit formula' }));

    expect(onStart).toHaveBeenCalledWith(target);
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it('keeps a rejected cell draft open for correction and retry', () => {
    const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells: { A1: '=1' } });
    const target = cellTargetAt(sheet, 'A1')!;
    const setOpen = vi.fn();
    const onCommit = vi.fn(() => ({ ok: false as const, reason: 'pending-model-transition' as const }));
    render(<FormulaPanel activeCell={target} editingCell={{ target, draft: '=draft', sessionId: 1 }} formulaResults={{}} onCancel={vi.fn()} onCommit={onCommit} onRawChange={vi.fn()} onStart={vi.fn()} open selectedSheet={sheet} setOpen={setOpen} sheets={[sheet]} workbook={workbookWithSheets([sheet])} />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onCommit).toHaveBeenCalledOnce();
    expect(setOpen).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Cell formula')).toHaveValue('=draft');
  });
});
