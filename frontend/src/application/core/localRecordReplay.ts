import type { Workbook } from '@workbook/core/model';
import { cellIdentityFromKey } from '@workbook/core/cellIdentity';
import type { FormulaCalculation } from '@calculation/formulaCalculation';
import { appendModelEntry } from './modelRowAppend';
import { settleSorting } from './settleSorting';

export type LocalRecordDelta = {
  sheetId: string;
  rowId: string;
  cells: Record<string, string>;
  orders: { sheetId: string; before: string[]; after: string[] }[];
};

export function admitLocalRecord(before: Workbook, sheetId: string, modelId: string, rowId: string, values: Readonly<Record<string, string>>, calculator: FormulaCalculation) {
  const candidate = appendModelEntry(before, sheetId, modelId, rowId, values);
  const workbook = settleSorting(candidate, calculator, { kind: 'structure' }).workbook;
  return { workbook, delta: captureLocalRecord(before, workbook, sheetId, rowId) };
}

export function captureLocalRecord(before: Workbook, after: Workbook, sheetId: string, rowId: string): LocalRecordDelta {
  const cells = Object.fromEntries(Object.entries(after.documents[sheetId].content.cells)
    .filter(([key]) => cellIdentityFromKey(key)?.rowId === rowId));
  const orders = Object.keys(after.documents).flatMap((id) => {
    const prior = before.documents[id]?.content.rows;
    const next = after.documents[id].content.rows;
    return prior && (id === sheetId || JSON.stringify(prior) !== JSON.stringify(next))
      ? [{ sheetId: id, before: [...prior], after: [...next] }] : [];
  });
  return { sheetId, rowId, cells, orders };
}

export function replayLocalRecord(workbook: Workbook, delta: LocalRecordDelta, direction: 'undo' | 'redo'): Workbook {
  const sheet = workbook.documents[delta.sheetId];
  if (!sheet) throw new Error('The record sheet is missing.');
  for (const order of delta.orders) {
    const current = workbook.documents[order.sheetId];
    if (!current || JSON.stringify(current.content.rows) !== JSON.stringify(order[direction === 'undo' ? 'after' : 'before'])) throw new Error('The record order changed.');
  }
  const currentCells = Object.fromEntries(Object.entries(sheet.content.cells).filter(([key]) => cellIdentityFromKey(key)?.rowId === delta.rowId));
  const expected = direction === 'undo' ? delta.cells : {};
  const keys = new Set([...Object.keys(currentCells), ...Object.keys(expected)]);
  if ([...keys].some((key) => currentCells[key] !== expected[key]) || Object.keys(delta.cells).some((key) => !sheet.content.columns.includes(cellIdentityFromKey(key)!.columnId))) throw new Error('The record cells changed.');
  const documents = { ...workbook.documents };
  for (const order of delta.orders) {
    const current = documents[order.sheetId];
    documents[order.sheetId] = { ...current, content: { ...current.content, rows: [...order[direction === 'undo' ? 'before' : 'after']] } };
  }
  const target = documents[delta.sheetId];
  const cells = { ...target.content.cells };
  for (const key of Object.keys(delta.cells)) {
    if (direction === 'undo') delete cells[key]; else cells[key] = delta.cells[key];
  }
  documents[delta.sheetId] = { ...target, content: { ...target.content, cells } };
  return { ...workbook, documents };
}
