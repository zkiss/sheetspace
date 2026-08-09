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
        kind: 'set-cell-content', sheetId: 'alpha', cell: cellIdentityAt(alpha.content, 'A1')!, raw: '=Beta!A1',
      } satisfies UserAction,
      impact: 'cells',
    },
    {
      label: 'row append',
      action: { kind: 'append-row', sheetId: 'alpha', rowId: 'new-row' } satisfies UserAction,
      impact: 'structure',
    },
    {
      label: 'column append',
      action: { kind: 'append-column', sheetId: 'alpha', columnId: 'new-column' } satisfies UserAction,
      impact: 'structure',
    },
    {
      label: 'metadata rename',
      action: { kind: 'rename-sheet', sheetId: 'alpha', name: ' Renamed ' } satisfies UserAction,
      impact: 'none',
    },
    {
      label: 'frame move',
      action: { kind: 'move-sheet-frame', sheetId: 'alpha', position: { x: 10, y: 20 } } satisfies UserAction,
      impact: 'none',
    },
    {
      label: 'frame resize',
      action: {
        kind: 'resize-sheet-frame', sheetId: 'alpha',
        position: { x: -5, y: 6 }, size: { width: 300, height: 220 },
      } satisfies UserAction,
      impact: 'none',
    },
    {
      label: 'z-order',
      action: { kind: 'change-sheet-z-order', sheetId: 'alpha', direction: 'top' } satisfies UserAction,
      impact: 'none',
    },
    {
      label: 'lifecycle delete',
      action: { kind: 'delete-sheet', sheetId: 'alpha' } satisfies UserAction,
      impact: 'structure',
    },
  ])('$label returns changed optimistic state and calculation impact', ({ action, impact }) => {
    const result = applyUserAction(workbook, action);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.nextWorkbook).not.toBe(workbook);
    expect(result.value.calculationImpact.kind).toBe(impact);
  });

  it('creates one deterministic optimistic sheet transition', () => {
    const sheet = sheetDocument({ id: 'pending:new', name: 'New', revision: 0, position: { x: 40, y: 50 }, zIndex: 3 });
    const action = { kind: 'create-sheet', sheet } satisfies UserAction;
    const first = applyUserAction(workbook, action);

    expect(first).toEqual(applyUserAction(workbook, action));
    expect(first).toMatchObject({
      ok: true,
      value: {
        nextWorkbook: { manifest: { sheetIds: ['alpha', 'beta', 'pending:new'] } },
        changed: true,
        calculationImpact: { kind: 'structure' },
      },
    });
  });

  it('stores a canonical formula and reports its exact calculation target', () => {
    const cell = cellIdentityAt(alpha.content, 'B2')!;
    const result = applyUserAction(workbook, {
      kind: 'set-cell-content', sheetId: 'alpha', cell, raw: '=Beta!A1',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        changed: true,
        calculationImpact: { kind: 'cells', cells: [{ sheetId: 'alpha', key: 'B2' }] },
      },
    });
    if (result.ok) expect(cellRawContent(result.value.nextWorkbook.documents.alpha, 'B2')).toBe('=beta!A1');
  });

  it('applies resize position and size in one state transition', () => {
    const result = applyUserAction(workbook, {
      kind: 'resize-sheet-frame', sheetId: 'alpha',
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
    const result = applyUserAction(workbook, {
      kind: 'change-sheet-z-order', sheetId: 'alpha', direction: 'top',
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
      action: { kind: 'append-row', sheetId: 'alpha', rowId: 'new-row' } satisfies UserAction,
      assertState: (next: Workbook) => expect(next.documents.alpha.content.rows.slice(-1)[0]).toBe('new-row'),
    },
    {
      label: 'column append',
      action: { kind: 'append-column', sheetId: 'alpha', columnId: 'new-column' } satisfies UserAction,
      assertState: (next: Workbook) => expect(next.documents.alpha.content.columns.slice(-1)[0]).toBe('new-column'),
    },
    {
      label: 'rename',
      action: { kind: 'rename-sheet', sheetId: 'alpha', name: 'Renamed' } satisfies UserAction,
      assertState: (next: Workbook) => expect(next.documents.alpha.name).toBe('Renamed'),
    },
    {
      label: 'move',
      action: { kind: 'move-sheet-frame', sheetId: 'alpha', position: { x: 8, y: 9 } } satisfies UserAction,
      assertState: (next: Workbook) => expect(next.documents.alpha.frame.position).toEqual({ x: 8, y: 9 }),
    },
  ])('$label deterministically changes current state', ({ action, assertState }) => {
    const first = applyUserAction(workbook, action);
    expect(first).toEqual(applyUserAction(workbook, action));
    if (first.ok) assertState(first.value.nextWorkbook);
  });

  it('deletes deterministically', () => {
    const action = { kind: 'delete-sheet', sheetId: 'alpha' } satisfies UserAction;
    const first = applyUserAction(workbook, action);

    expect(first).toEqual(applyUserAction(workbook, action));
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
    const result = applyUserAction(source, {
      kind: 'set-cell-content', sheetId: 'alpha', cell: cellIdentityAt(sheet.content, 'A1')!, raw,
    });
    expect(result).toEqual({
      ok: true,
      value: { nextWorkbook: source, changed: false, calculationImpact: { kind: 'none' } },
    });
  });

  it.each([
    ['unknown sheet', { kind: 'delete-sheet', sheetId: 'missing' } satisfies UserAction, 'unknown-sheet'],
    ['invalid cell', { kind: 'set-cell-content', sheetId: 'alpha', cell: { rowId: 'missing', columnId: 'missing' }, raw: 'x' } satisfies UserAction, 'invalid-cell'],
    ['duplicate row id', { kind: 'append-row', sheetId: 'alpha', rowId: alpha.content.rows[0] } satisfies UserAction, 'duplicate-row-id'],
    ['duplicate column id', { kind: 'append-column', sheetId: 'alpha', columnId: alpha.content.columns[0] } satisfies UserAction, 'duplicate-column-id'],
    ['empty name', { kind: 'rename-sheet', sheetId: 'alpha', name: ' ' } satisfies UserAction, 'empty-sheet-name'],
    ['duplicate name', { kind: 'rename-sheet', sheetId: 'alpha', name: 'Beta' } satisfies UserAction, 'duplicate-sheet-name'],
  ])('rejects $label without mutating input', (_label, action, reason) => {
    const before: Workbook = structuredClone(workbook);
    expect(applyUserAction(workbook, action)).toEqual({ ok: false, reason });
    expect(workbook).toEqual(before);
  });
});
