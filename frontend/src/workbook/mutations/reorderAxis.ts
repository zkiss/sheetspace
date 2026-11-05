import type { Workbook } from '../core/model';

export type ReorderAxis = 'row' | 'column';
export type ReorderResult =
  | { status: 'changed'; workbook: Workbook; before: readonly string[]; after: readonly string[] }
  | { status: 'unchanged'; workbook: Workbook }
  | { status: 'rejected'; workbook: Workbook; reason: 'unknown-sheet' | 'model-columns' | 'invalid-axis' | 'invalid-selection' | 'invalid-gap' | 'invalid-permutation' | 'invalid-direction' };

function axisOrder(workbook: Workbook, sheetId: string, axis: ReorderAxis): readonly string[] | ReorderResult {
  const sheet = workbook.documents[sheetId];
  if (!sheet) return { status: 'rejected', workbook, reason: 'unknown-sheet' };
  if (axis !== 'row' && axis !== 'column') return { status: 'rejected', workbook, reason: 'invalid-axis' };
  if (axis === 'column' && sheet.modelId !== undefined) return { status: 'rejected', workbook, reason: 'model-columns' };
  return axis === 'row' ? sheet.content.rows : sheet.content.columns;
}

function validSelection(order: readonly string[], ids: readonly string[]): boolean {
  const available = new Set(order);
  return available.size === order.length && ids.length > 0 && new Set(ids).size === ids.length && ids.every((id) => available.has(id));
}

export function applyAxisPermutation(workbook: Workbook, sheetId: string, axis: ReorderAxis, permutation: readonly string[]): ReorderResult {
  const order = axisOrder(workbook, sheetId, axis);
  if (!Array.isArray(order)) return order as ReorderResult;
  if (permutation.length !== order.length || new Set(order).size !== order.length || new Set(permutation).size !== permutation.length || permutation.some((id) => !order.includes(id))) {
    return { status: 'rejected', workbook, reason: 'invalid-permutation' };
  }
  if (order.every((id, index) => id === permutation[index])) return { status: 'unchanged', workbook };
  const sheet = workbook.documents[sheetId]!;
  const after = [...permutation];
  const content = axis === 'row' ? { ...sheet.content, rows: after } : { ...sheet.content, columns: after };
  return { status: 'changed', workbook: { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, content } } }, before: [...order], after };
}

export function gatherAxis(workbook: Workbook, sheetId: string, axis: ReorderAxis, ids: readonly string[], gap: number): ReorderResult {
  const order = axisOrder(workbook, sheetId, axis);
  if (!Array.isArray(order)) return order as ReorderResult;
  if (!validSelection(order, ids)) return { status: 'rejected', workbook, reason: 'invalid-selection' };
  if (!Number.isInteger(gap) || gap < 0 || gap > order.length) return { status: 'rejected', workbook, reason: 'invalid-gap' };
  const selected = new Set(ids);
  const block = order.filter((id) => selected.has(id));
  const remaining = order.filter((id) => !selected.has(id));
  const insertion = gap - order.slice(0, gap).filter((id) => selected.has(id)).length;
  remaining.splice(insertion, 0, ...block);
  return applyAxisPermutation(workbook, sheetId, axis, remaining);
}

export function shiftAxis(workbook: Workbook, sheetId: string, axis: ReorderAxis, ids: readonly string[], direction: -1 | 1): ReorderResult {
  const order = axisOrder(workbook, sheetId, axis);
  if (!Array.isArray(order)) return order as ReorderResult;
  if (!validSelection(order, ids)) return { status: 'rejected', workbook, reason: 'invalid-selection' };
  if (direction !== -1 && direction !== 1) return { status: 'rejected', workbook, reason: 'invalid-direction' };
  const selected = new Set(ids);
  if (selected.has(order[direction === -1 ? 0 : order.length - 1]!)) return { status: 'unchanged', workbook };
  const after = [...order];
  for (let index = direction === -1 ? 1 : after.length - 2; index >= 0 && index < after.length; index -= direction) {
    if (selected.has(after[index]!) && !selected.has(after[index + direction]!)) {
      [after[index], after[index + direction]] = [after[index + direction]!, after[index]!];
    }
  }
  return applyAxisPermutation(workbook, sheetId, axis, after);
}
