import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { measuredElementGeometry, virtualGridGeometry } from '@test-support/domGeometry';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

describe('reference range reveal in the composed workspace', () => {
  it.each([
    { reference: 'A3:A5', anchor: 'A3', end: 'A5', movesX: false, movesY: true, variableSizes: false },
    { reference: 'B1:C1', anchor: 'B1', end: 'C1', movesX: true, movesY: false, variableSizes: false },
    { reference: 'B3:C5', anchor: 'B3', end: 'C5', movesX: true, movesY: true, variableSizes: true },
  ])('reveals all of $reference when its anchor is already visible', ({ reference, anchor, end, movesX, movesY, variableSizes }) => {
    const inputs = sheetDocument({
      id: 'inputs', name: 'Inputs', rowCount: 30, columnCount: 10,
      frameSize: { width: 240, height: 160 },
      presentation: variableSizes ? {
        rowHeights: { 'inputs:row:3': 35.3, 'inputs:row:4': 25.4, 'inputs:row:5': 30.7 },
        columnWidths: { 'inputs:column:2': 80.6, 'inputs:column:3': 90.2 },
      } : undefined,
    });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: `=SUM(inputs!${reference})` } });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
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
    if (movesX) expect(edges(cell(end)).right).toBeGreaterThan(body.clientWidth);
    if (movesY) expect(edges(cell(end)).bottom).toBeGreaterThan(body.clientHeight);

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    fireEvent.click(screen.getByRole('button', { name: `Inputs!${reference}, reference` }), { ctrlKey: true });

    expect(cell(anchor)).toHaveFocus();
    expect(cell(end)).toHaveAttribute('data-reference-selected', 'true');
    expect(cell(end)).toHaveAttribute('data-navigation-highlight', 'true');
    expect(edges(cell(anchor)).left).toBeGreaterThanOrEqual(40 - 1e-9);
    expect(edges(cell(anchor)).top).toBeGreaterThanOrEqual(26.4 - 1e-9);
    expect(edges(cell(end)).right).toBeLessThanOrEqual(body.clientWidth + 1e-9);
    expect(edges(cell(end)).bottom).toBeLessThanOrEqual(body.clientHeight + 1e-9);
    if (!movesX) expect(body.scrollLeft).toBe(0);
    if (!movesY) expect(body.scrollTop).toBe(0);
  });
});
