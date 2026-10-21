import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { autosaveClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

/** A sheet whose first column the model calculates and whose second column holds manual input. */
function calculatedSheetWorkbook(): Workbook {
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 2, columnCount: 2, cells: { B1: '3' } });
  const model: DataModel = {
    id: 'model',
    name: 'Model',
    columns: [
      { id: 'total', name: 'Total', kind: 'calculated', type: 'float', formula: '=SUM(@B[1]) * 2' },
      { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
    ],
  };
  const bound = bindSheetToModel({ ...workbookWithSheets([sheet]), dataModels: { model } }, sheet.id, model.id, () => 'unused-column');
  if (!bound.ok) throw new Error(bound.reason);
  return bound.value;
}

function gridCell(key: string) {
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`);
  if (!cell) throw new Error(`Missing cell ${key}`);
  return cell;
}

describe('App calculated-cell protection', () => {
  it('refuses to clear a calculated cell and explains that the model owns the calculation', () => {
    const apiClient = autosaveClient();
    render(<App initialWorkbook={calculatedSheetWorkbook()} apiClient={apiClient} />);
    const calculatedText = gridCell('A1').textContent;

    fireEvent.click(gridCell('A1'));
    fireEvent.keyDown(gridCell('A1'), { key: 'Delete' });

    expect(screen.getByRole('alert')).toHaveTextContent('calculated in the data model');
    expect(gridCell('A1').textContent).toBe(calculatedText);
    expect(apiClient.writeCells).not.toHaveBeenCalled();
  });

  it('refuses to clear a range that mixes a manual cell with a calculated one and keeps the selection', () => {
    const apiClient = autosaveClient();
    render(<App initialWorkbook={calculatedSheetWorkbook()} apiClient={apiClient} />);
    const calculatedText = gridCell('A1').textContent;

    fireEvent.click(gridCell('A1'));
    fireEvent.click(gridCell('B1'), { shiftKey: true });
    fireEvent.keyDown(gridCell('B1'), { key: 'Delete' });

    expect(screen.getByRole('alert')).toHaveTextContent('calculated in the data model');
    expect(gridCell('A1').textContent).toBe(calculatedText);
    expect(gridCell('B1')).toHaveTextContent('3');
    expect(gridCell('A1')).toHaveAttribute('aria-selected', 'true');
    expect(gridCell('B1')).toHaveAttribute('aria-selected', 'true');
    expect(apiClient.writeCells).not.toHaveBeenCalled();
  });
});
