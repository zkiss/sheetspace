import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from './test/workbookFactories';
import { applyUserAction, type UserAction } from './userActions';
import { cellIdentityAt, cellRawContent, type Workbook } from './workbook';

const alpha = sheetDocument({ id: 'alpha', name: 'Alpha', revision: 4, zIndex: 1 });
const beta = sheetDocument({ id: 'beta', name: 'Beta', revision: 7, zIndex: 2 });
const workbook = workbookWithSheets([alpha, beta], 3);

describe('applyUserAction', () => {
  it.each([
    {
      label: 'cell content',
      action: {
        kind: 'set-cell-content', clientActionId: 'action-cell', sheetId: 'alpha',
        cell: cellIdentityAt(alpha.content, 'A1')!, raw: '=Beta!A1',
      } satisfies UserAction,
      operationKinds: ['set-cell-content'], scope: 'sheet', impact: 'cells',
    },
    {
      label: 'row append',
      action: { kind: 'append-row', clientActionId: 'action-row', sheetId: 'alpha', rowId: 'new-row' } satisfies UserAction,
      operationKinds: ['append-row'], scope: 'sheet', impact: 'structure',
    },
    {
      label: 'column append',
      action: { kind: 'append-column', clientActionId: 'action-column', sheetId: 'alpha', columnId: 'new-column' } satisfies UserAction,
      operationKinds: ['append-column'], scope: 'sheet', impact: 'structure',
    },
    {
      label: 'metadata rename',
      action: { kind: 'rename-sheet', clientActionId: 'action-rename', sheetId: 'alpha', name: ' Renamed ' } satisfies UserAction,
      operationKinds: ['rename-sheet'], scope: 'sheet', impact: 'none',
    },
    {
      label: 'frame move',
      action: { kind: 'move-sheet-frame', clientActionId: 'action-move', sheetId: 'alpha', position: { x: 10, y: 20 } } satisfies UserAction,
      operationKinds: ['set-sheet-frame'], scope: 'sheet', impact: 'none',
    },
    {
      label: 'frame resize',
      action: {
        kind: 'resize-sheet-frame', clientActionId: 'action-resize', sheetId: 'alpha',
        position: { x: -5, y: 6 }, size: { width: 300, height: 220 },
      } satisfies UserAction,
      operationKinds: ['set-sheet-frame'], scope: 'sheet', impact: 'none',
    },
    {
      label: 'z-order',
      action: { kind: 'change-sheet-z-order', clientActionId: 'action-z', sheetId: 'alpha', direction: 'top' } satisfies UserAction,
      operationKinds: ['set-sheet-z-index', 'set-sheet-z-index'], scope: 'multi-sheet', impact: 'none',
    },
    {
      label: 'lifecycle delete',
      action: { kind: 'delete-sheet', clientActionId: 'action-delete', sheetId: 'alpha' } satisfies UserAction,
      operationKinds: ['delete-sheet'], scope: 'multi-sheet', impact: 'structure',
    },
  ])('$label returns concrete operations and calculation impact', ({ action, operationKinds, scope, impact }) => {
    const result = applyUserAction(workbook, action);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changeSet).toMatchObject({ clientActionId: action.clientActionId, scope });
    expect(result.value.changeSet.operations.map((operation) => operation.kind)).toEqual(operationKinds);
    expect(result.value.calculationImpact.kind).toBe(impact);
  });

  it('creates one deterministic lifecycle change with explicit ids', () => {
    const sheet = sheetDocument({ id: 'pending:new', name: 'New', revision: 0, position: { x: 40, y: 50 }, zIndex: 3 });
    const action = { kind: 'create-sheet', clientActionId: 'action-create', sheet } satisfies UserAction;
    const first = applyUserAction(workbook, action);
    const second = applyUserAction(workbook, action);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      value: {
        nextWorkbook: { manifest: { sheetIds: ['alpha', 'beta', 'pending:new'] } },
        changeSet: {
          scope: 'multi-sheet', clientActionId: 'action-create', expectedManifestRevision: 3,
          expectedSheetRevisions: [], operations: [{ kind: 'create-sheet', sheet }],
        },
        calculationImpact: { kind: 'structure' },
      },
    });
  });

  it('records stable cell identity, canonical formula, revision, and exact calculation target', () => {
    const cell = cellIdentityAt(alpha.content, 'B2')!;
    const result = applyUserAction(workbook, {
      kind: 'set-cell-content', clientActionId: 'action-cell', sheetId: 'alpha', cell, raw: '=Beta!A1',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        changeSet: {
          scope: 'sheet', expectedRevision: { sheetId: 'alpha', revision: 4 },
          operations: [{ kind: 'set-cell-content', sheetId: 'alpha', cell, raw: '=beta!A1' }],
        },
        calculationImpact: { kind: 'cells', cells: [{ sheetId: 'alpha', key: 'B2' }] },
      },
    });
    if (result.ok) expect(cellRawContent(result.value.nextWorkbook.documents.alpha, 'B2')).toBe('=beta!A1');
  });

  it('makes resize one operation containing position and size', () => {
    const result = applyUserAction(workbook, {
      kind: 'resize-sheet-frame', clientActionId: 'action-resize', sheetId: 'alpha',
      position: { x: 12, y: 34 }, size: { width: 500, height: 400 },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        changeSet: {
          scope: 'sheet', expectedRevision: { sheetId: 'alpha', revision: 4 },
          operations: [{
            kind: 'set-sheet-frame', sheetId: 'alpha',
            frame: { position: { x: 12, y: 34 }, size: { width: 500, height: 400 }, zIndex: 1 },
          }],
        },
        calculationImpact: { kind: 'none' },
      },
    });
  });

  it('captures every touched revision for a multi-sheet z-order action', () => {
    const result = applyUserAction(workbook, {
      kind: 'change-sheet-z-order', clientActionId: 'action-z', sheetId: 'alpha', direction: 'top',
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        changeSet: {
          scope: 'multi-sheet', expectedManifestRevision: 3,
          expectedSheetRevisions: [{ sheetId: 'alpha', revision: 4 }, { sheetId: 'beta', revision: 7 }],
        },
      },
    });
  });

  it.each([
    ['unknown sheet', { kind: 'delete-sheet', clientActionId: 'bad', sheetId: 'missing' } satisfies UserAction, 'unknown-sheet'],
    ['invalid cell', { kind: 'set-cell-content', clientActionId: 'bad', sheetId: 'alpha', cell: { rowId: 'missing', columnId: 'missing' }, raw: 'x' } satisfies UserAction, 'invalid-cell'],
    ['duplicate row id', { kind: 'append-row', clientActionId: 'bad', sheetId: 'alpha', rowId: alpha.content.rows[0] } satisfies UserAction, 'duplicate-row-id'],
    ['duplicate column id', { kind: 'append-column', clientActionId: 'bad', sheetId: 'alpha', columnId: alpha.content.columns[0] } satisfies UserAction, 'duplicate-column-id'],
    ['empty name', { kind: 'rename-sheet', clientActionId: 'bad', sheetId: 'alpha', name: ' ' } satisfies UserAction, 'empty-sheet-name'],
    ['duplicate name', { kind: 'rename-sheet', clientActionId: 'bad', sheetId: 'alpha', name: 'Beta' } satisfies UserAction, 'duplicate-sheet-name'],
  ])('rejects $label without mutating input', (_label, action, reason) => {
    const before: Workbook = structuredClone(workbook);
    expect(applyUserAction(workbook, action)).toEqual({ ok: false, reason });
    expect(workbook).toEqual(before);
  });
});
