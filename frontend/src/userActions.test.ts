import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from './test/workbookFactories';
import {
  applyBackendWorkbookReconciliation,
  applyWorkbookOperation,
  type BackendWorkbookReconciliation,
  type WorkbookOperation,
} from './userActions';
import { cellIdentityAt } from './workbook/core/cellIdentity';
import { cellRawContent } from './workbook/read/queries';
import { type Workbook } from './workbook/core/model';

const alpha = sheetDocument({ id: 'alpha', name: 'Alpha', revision: 4, zIndex: 1 });
const beta = sheetDocument({ id: 'beta', name: 'Beta', revision: 7, zIndex: 2 });
const workbook = workbookWithSheets([alpha, beta], 3);

describe('workbook operations', () => {
  it.each([
    {
      label: 'cell content',
      action: {
        kind: 'write-cells', operationId: 'cell-write', sheetId: 'alpha',
        writes: [{ cell: cellIdentityAt(alpha.content, 'A1')!, raw: '=Beta!A1' }],
      } satisfies WorkbookOperation,
      impact: 'cells',
    },
    {
      label: 'metadata rename',
      action: { kind: 'rename-sheet', operationId: 'rename', sheetId: 'alpha', name: ' Renamed ' } satisfies WorkbookOperation,
      impact: 'none',
    },
    {
      label: 'frame move',
      action: { kind: 'move-sheet-frame', operationId: 'move', sheetId: 'alpha', position: { x: 10, y: 20 } } satisfies WorkbookOperation,
      impact: 'none',
    },
    {
      label: 'frame resize',
      action: {
        kind: 'resize-sheet-frame', operationId: 'resize', sheetId: 'alpha',
        position: { x: -5, y: 6 }, size: { width: 300, height: 220 },
      } satisfies WorkbookOperation,
      impact: 'none',
    },
    {
      label: 'z-order',
      action: { kind: 'change-sheet-z-order', operationId: 'z-order', sheetId: 'alpha', direction: 'top' } satisfies WorkbookOperation,
      impact: 'none',
    },
    {
      label: 'lifecycle delete',
      action: { kind: 'delete-sheet', operationId: 'delete', sheetId: 'alpha' } satisfies WorkbookOperation,
      impact: 'structure',
    },
  ])('$label returns changed optimistic state and calculation impact', ({ action, impact }) => {
    const result = applyWorkbookOperation(workbook, action);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.nextWorkbook).not.toBe(workbook);
    expect(result.value.calculationImpact.kind).toBe(impact);
  });

  it('stores a canonical formula and reports its exact calculation target', () => {
    const cell = cellIdentityAt(alpha.content, 'B2')!;
    const result = applyWorkbookOperation(workbook, {
      kind: 'write-cells', operationId: 'formula-write', sheetId: 'alpha', writes: [{ cell, raw: '=Beta!A1' }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        changed: true,
        calculationImpact: { kind: 'cells', cells: [{ sheetId: 'alpha', key: 'B2' }] },
      },
    });
    if (result.ok) expect(cellRawContent(result.value.nextWorkbook.documents.alpha, 'B2')).toBe('=beta!@[beta:column:1,beta:row:1]');
  });

  it('applies resize position and size in one state transition', () => {
    const result = applyWorkbookOperation(workbook, {
      kind: 'resize-sheet-frame', operationId: 'resize', sheetId: 'alpha',
      position: { x: 12, y: 34 }, size: { width: 500, height: 400 },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        nextWorkbook: {
          documents: {
            alpha: {
              frame: { position: { x: 12, y: 34 }, size: { width: 500, height: 400 }, zIndex: 1 },
            },
          },
        },
        changed: true,
        calculationImpact: { kind: 'none' },
      },
    });
  });

  it('updates every affected sheet in one z-order state transition', () => {
    const result = applyWorkbookOperation(workbook, {
      kind: 'change-sheet-z-order', operationId: 'z-order', sheetId: 'alpha', direction: 'top',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        nextWorkbook: {
          documents: {
            alpha: { frame: { zIndex: 2 } },
            beta: { frame: { zIndex: 1 } },
          },
        },
        changed: true,
      },
    });
  });

  it.each([
    {
      label: 'row append',
      action: { kind: 'append-row', sheetId: 'alpha', rowId: 'new-row' } satisfies BackendWorkbookReconciliation,
      assertState: (next: Workbook) => expect(next.documents.alpha.content.rows.slice(-1)[0]).toBe('new-row'),
    },
    {
      label: 'column append',
      action: { kind: 'append-column', sheetId: 'alpha', columnId: 'new-column' } satisfies BackendWorkbookReconciliation,
      assertState: (next: Workbook) => expect(next.documents.alpha.content.columns.slice(-1)[0]).toBe('new-column'),
    },
  ])('$label reconciliation deterministically changes current state', ({ action, assertState }) => {
    const first = applyBackendWorkbookReconciliation(workbook, action);
    expect(first).toEqual(applyBackendWorkbookReconciliation(workbook, action));
    if (first.ok) assertState(first.value.nextWorkbook);
  });

  it.each([
    {
      label: 'rename',
      action: { kind: 'rename-sheet', operationId: 'rename', sheetId: 'alpha', name: 'Renamed' } satisfies WorkbookOperation,
      assertState: (next: Workbook) => expect(next.documents.alpha.name).toBe('Renamed'),
    },
    {
      label: 'move',
      action: { kind: 'move-sheet-frame', operationId: 'move', sheetId: 'alpha', position: { x: 8, y: 9 } } satisfies WorkbookOperation,
      assertState: (next: Workbook) => expect(next.documents.alpha.frame.position).toEqual({ x: 8, y: 9 }),
    },
  ])('$label deterministically changes current state', ({ action, assertState }) => {
    const first = applyWorkbookOperation(workbook, action);
    expect(first).toEqual(applyWorkbookOperation(workbook, action));
    if (first.ok) assertState(first.value.nextWorkbook);
  });

  it('deletes deterministically', () => {
    const action = { kind: 'delete-sheet', operationId: 'delete', sheetId: 'alpha' } satisfies WorkbookOperation;
    const first = applyWorkbookOperation(workbook, action);

    expect(first).toEqual(applyWorkbookOperation(workbook, action));
    expect(first).toMatchObject({
      ok: true,
      value: {
        nextWorkbook: { manifest: { sheetIds: ['beta'] } },
        changed: true,
        calculationImpact: { kind: 'structure' },
      },
    });
    if (first.ok) expect(first.value.nextWorkbook.documents.alpha).toBeUndefined();
  });

  it.each([
    ['same canonical cell value', workbookWithSheets([sheetDocument({ id: 'alpha', name: 'Alpha', cells: { A1: 'same' } })]), 'same'],
    ['already empty cell', workbook, ''],
  ])('treats $label as no state or calculation work', (_label, source, raw) => {
    const sheet = source.documents.alpha;
    const result = applyWorkbookOperation(source, {
      kind: 'write-cells', operationId: 'write', sheetId: 'alpha',
      writes: [{ cell: cellIdentityAt(sheet.content, 'A1')!, raw }],
    });
    expect(result).toMatchObject({
      ok: true,
      value: { nextWorkbook: source, changed: false, calculationImpact: { kind: 'none' } },
    });
  });

  it('applies a batch of cell writes atomically with canonical persistence and inverse data', () => {
    const a1 = cellIdentityAt(alpha.content, 'A1')!;
    const b2 = cellIdentityAt(alpha.content, 'B2')!;
    const result = applyWorkbookOperation(workbookWithSheets([
      sheetDocument({ id: 'alpha', name: 'Alpha', cells: { A1: 'old' } }), beta,
    ]), {
      kind: 'write-cells', operationId: 'write-1', sheetId: 'alpha',
      writes: [{ cell: a1, raw: '' }, { cell: b2, raw: '=Beta!A1' }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        changed: true,
        calculationImpact: { kind: 'cells', cells: [{ sheetId: 'alpha', key: 'A1' }, { sheetId: 'alpha', key: 'B2' }] },
        persistence: { kind: 'write-cells', sheetId: 'alpha', writes: [{ cell: a1, raw: '' }, { cell: b2, raw: '=beta!@[beta:column:1,beta:row:1]' }] },
        inverse: { kind: 'write-cells', sheetId: 'alpha', writes: [{ cell: b2, raw: '' }, { cell: a1, raw: 'old' }] },
      },
    });
    if (result.ok) {
      expect(cellRawContent(result.value.nextWorkbook.documents.alpha, 'A1')).toBeUndefined();
      expect(cellRawContent(result.value.nextWorkbook.documents.alpha, 'B2')).toBe('=beta!@[beta:column:1,beta:row:1]');
    }
  });

  it('rejects any invalid batch target before changing a valid target', () => {
    const source = workbookWithSheets([alpha, beta]);
    const result = applyWorkbookOperation(source, {
      kind: 'write-cells', operationId: 'write-2', sheetId: 'alpha',
      writes: [{ cell: cellIdentityAt(alpha.content, 'A1')!, raw: 'valid' }, { cell: { rowId: 'missing', columnId: 'missing' }, raw: 'invalid' }],
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-cell' });
    expect(source).toEqual(workbookWithSheets([alpha, beta]));
  });

  it('uses plain serializable operation and persistence shapes', () => {
    const operation = {
      kind: 'write-cells', operationId: 'write-3', sheetId: 'alpha',
      writes: [{ cell: cellIdentityAt(alpha.content, 'A1')!, raw: 'value' }],
    } satisfies WorkbookOperation;
    const result = applyWorkbookOperation(workbook, operation);
    expect(JSON.parse(JSON.stringify(operation))).toEqual(operation);
    if (result.ok) expect(JSON.parse(JSON.stringify(result.value.persistence))).toEqual(result.value.persistence);
  });

  it.each([
    ['unknown sheet', { kind: 'delete-sheet', operationId: 'delete', sheetId: 'missing' } satisfies WorkbookOperation, 'unknown-sheet'],
    ['invalid cell', { kind: 'write-cells', operationId: 'write', sheetId: 'alpha', writes: [{ cell: { rowId: 'missing', columnId: 'missing' }, raw: 'x' }] } satisfies WorkbookOperation, 'invalid-cell'],
    ['empty name', { kind: 'rename-sheet', operationId: 'rename', sheetId: 'alpha', name: ' ' } satisfies WorkbookOperation, 'empty-sheet-name'],
    ['duplicate name', { kind: 'rename-sheet', operationId: 'rename', sheetId: 'alpha', name: 'Beta' } satisfies WorkbookOperation, 'duplicate-sheet-name'],
  ])('rejects $label operation without mutating input', (_label, action, reason) => {
    const before: Workbook = structuredClone(workbook);
    expect(applyWorkbookOperation(workbook, action)).toEqual({ ok: false, reason });
    expect(workbook).toEqual(before);
  });

  it.each([
    ['duplicate row id', { kind: 'append-row', sheetId: 'alpha', rowId: alpha.content.rows[0] } satisfies BackendWorkbookReconciliation, 'duplicate-row-id'],
    ['duplicate column id', { kind: 'append-column', sheetId: 'alpha', columnId: alpha.content.columns[0] } satisfies BackendWorkbookReconciliation, 'duplicate-column-id'],
  ])('rejects $label reconciliation without mutating input', (_label, action, reason) => {
    const before: Workbook = structuredClone(workbook);
    expect(applyBackendWorkbookReconciliation(workbook, action)).toEqual({ ok: false, reason });
    expect(workbook).toEqual(before);
  });
});
