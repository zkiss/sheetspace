import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { measuredElementGeometry, virtualGridGeometry } from '@test-support/domGeometry';
import { sheetDocument, workbookWithLegacyFormulaFixtures } from '@test-support/workbookFactories';
import { App } from './App';

describe('reference range reveal in the composed workspace', () => {
  it('navigates an open range from its terminal column to the current last row', () => {
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 5, columnCount: 3 });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: '=SUM(@inputs!B[3]:C)' } });
    render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([inputs, outputs])} />);
    const source = screen.getByRole('cell', { name: 'Outputs A1 cell' });
    fireEvent.click(source);
    fireEvent.keyDown(source, { key: 'F2' });
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Outputs A1 editor' });
    editor.setSelectionRange(editor.value.indexOf(':C') + 1, editor.value.indexOf(':C') + 1);
    fireEvent.keyDown(editor, { key: 'F4' });
    expect(screen.getByRole('cell', { name: 'Inputs B3 empty cell' })).toHaveFocus();
    expect(screen.getByRole('cell', { name: 'Inputs C5 empty cell' })).toHaveAttribute('data-reference-selected', 'true');
  });
  it('reveals a variable-metric range on both axes when its anchor is already visible', () => {
    const reference = 'B[3]:C[5]'; const anchor = 'B3'; const end = 'C5';
    const inputs = sheetDocument({
      id: 'inputs', name: 'Inputs', rowCount: 30, columnCount: 10,
      frameSize: { width: 240, height: 160 },
      presentation: {
        rowHeights: { 'inputs:row:3': 35.3, 'inputs:row:4': 25.4, 'inputs:row:5': 30.7 },
        columnWidths: { 'inputs:column:2': 80.6, 'inputs:column:3': 90.2 },
      },
    });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: `=SUM(@inputs!${reference})` } });
    render(<App initialWorkbook={workbookWithLegacyFormulaFixtures([inputs, outputs])} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const body = within(frame).getByTestId('sheet-frame-body');
    act(() => {
      measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
      virtualGridGeometry(body, { width: 238, height: 126 });
    });
    const cell = (key: string) => within(frame).getByRole('cell', { name: `Inputs ${key} empty cell` });
    const edges = (element: HTMLElement) => ({
      left: Number.parseFloat(element.style.left) - body.scrollLeft,
      right: Number.parseFloat(element.style.left) + Number.parseFloat(element.style.width) - body.scrollLeft,
      top: Number.parseFloat(element.parentElement!.style.top) - body.scrollTop,
      bottom: Number.parseFloat(element.parentElement!.style.top) + Number.parseFloat(element.parentElement!.style.height) - body.scrollTop,
    });
    expect(edges(cell(anchor)).left).toBeGreaterThanOrEqual(40);
    expect(edges(cell(anchor)).top).toBeGreaterThanOrEqual(26.4);
    expect(edges(cell(anchor)).right).toBeLessThanOrEqual(body.clientWidth);
    expect(edges(cell(anchor)).bottom).toBeLessThanOrEqual(body.clientHeight);
    expect(edges(cell(end)).right).toBeGreaterThan(body.clientWidth);
    expect(edges(cell(end)).bottom).toBeGreaterThan(body.clientHeight);

    const source = screen.getByRole('cell', { name: 'Outputs A1 cell' });
    fireEvent.click(source);
    fireEvent.keyDown(source, { key: 'F2' });
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Outputs A1 editor' });
    editor.setSelectionRange(8, 8);
    fireEvent.keyDown(editor, { key: 'F4' });

    expect(cell(anchor)).toHaveFocus();
    expect(cell(end)).toHaveAttribute('data-reference-selected', 'true');
    expect(cell(end)).toHaveAttribute('data-navigation-highlight', 'true');
    expect(edges(cell(anchor)).left).toBeGreaterThanOrEqual(40 - 1e-9);
    expect(edges(cell(anchor)).top).toBeGreaterThanOrEqual(26.4 - 1e-9);
    expect(edges(cell(end)).right).toBeLessThanOrEqual(body.clientWidth + 1e-9);
    expect(edges(cell(end)).bottom).toBeLessThanOrEqual(body.clientHeight + 1e-9);
  });
});
