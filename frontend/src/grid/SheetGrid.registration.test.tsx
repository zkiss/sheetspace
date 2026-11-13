import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { createRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { projectGridAxes } from './gridAxisProjection';
import { SheetGrid } from './SheetGrid';
import { sheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';

const registrations = vi.hoisted(() => new Map<string, unknown>());
vi.mock('./SheetGridCell', async (importOriginal) => {
  const original = await importOriginal<typeof import('./SheetGridCell')>();
  return { ...original, SheetGridCell: (props: Parameters<typeof original.SheetGridCell>[0]) => {
    registrations.set(props.cellKey, props.registerCell);
    return <original.SheetGridCell {...props} />;
  } };
});
afterEach(() => { cleanup(); registrations.clear(); });

it('keeps cell registration stable until a focus target changes and registers the new target', () => {
  const sheet = tabularProjection(sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 2, columnCount: 2 }));
  const axisProjection = projectGridAxes(sheet, { columns: [], rows: [] });
  const ref = createRef<HTMLDivElement>();
  const consumed = vi.fn();
  const props = {
    sheet, axisProjection, activeCellKey: 'A1', editingCell: null, formulaResults: {}, navigationHighlightCellKey: null,
    cellInteraction: { clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() },
    editorInteraction: { FormulaEditor: FormulaEditorPanel, cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() },
    scrollContainerRef: ref, onKeyboardFocusRequestConsumed: consumed,
  };
  const view = render(<div ref={ref}><SheetGrid {...props} keyboardFocusRequest={null} /></div>);
  const initial = registrations.get('A1');
  expect(initial).toBeTypeOf('function');
  view.rerender(<div ref={ref}><SheetGrid {...props} cellInteraction={{ ...props.cellInteraction }} keyboardFocusRequest={null} /></div>);
  expect(registrations.get('A1')).toBe(initial);
  view.rerender(<div ref={ref}><SheetGrid {...props} keyboardFocusRequest={{ id: 1, targetKey: 'B2' }} /></div>);
  expect(registrations.get('B2')).not.toBe(initial);
  expect(view.container.querySelector('[data-cell-key="B2"]')).toHaveFocus();
  expect(consumed).toHaveBeenCalledWith(1);
});
