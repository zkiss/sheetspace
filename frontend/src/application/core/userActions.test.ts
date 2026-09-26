import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import {
  applyBackendWorkbookReconciliation,
  applyWorkbookOperation,
  prepareMoveCellWrites,
  preparePasteCellWrites,
  replayCellPersistenceWrites,
  type BackendWorkbookReconciliation,
  type CellWrite,
  type WorkbookOperation,
} from '@application/core/userActions';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { cellRawContent } from '@workbook/read/queries';
import { type Workbook } from '@workbook/core/model';
import type { ClipboardSourceSnapshot } from '@application/core/clipboardPayload';

const alpha = sheetDocument({ id: 'alpha', name: 'Alpha', revision: 4, zIndex: 1 });
const beta = sheetDocument({ id: 'beta', name: 'Beta', revision: 7, zIndex: 2 });
const workbook = workbookWithSheets([alpha, beta], 3);
const write = (sheetId: string, cell: { rowId: string; columnId: string }, raw: string): CellWrite => ({ sheetId, ...cell, raw });
const persistenceWrite = (sheetId: string, cell: { rowId: string; columnId: string }, beforeRaw: string | null, afterRaw: string | null) => ({ sheetId, ...cell, beforeRaw, afterRaw });

describe('workbook operations', () => {
  it.each([
    {
      label: 'cell content',
      action: {
        kind: 'write-cells', operationId: 'cell-write',
        writes: [write('alpha', cellIdentityAt(alpha.content, 'A1')!, '=Beta!A1')],
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
      kind: 'write-cells', operationId: 'formula-write', writes: [write('alpha', cell, '=Beta!A1')],
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
              frame: { position: { x: 12, y: 34 }, size: { width: 500, height: 400 }, visualScale: 1, zIndex: 1 },
            },
          },
        },
        changed: true,
        calculationImpact: { kind: 'none' },
      },
    });
  });

  it('commits valid visual scale without calculation invalidation and retains it through resize', () => {
    const scaled = applyWorkbookOperation(workbook, {
      kind: 'set-sheet-visual-scale', operationId: 'scale', sheetId: 'alpha', visualScale: 0.5,
    });
    expect(scaled).toMatchObject({ ok: true, value: { calculationImpact: { kind: 'none' }, persistence: { kind: 'update-sheet-visual-scale', visualScale: 0.5 } } });
    if (!scaled.ok) return;
    const resized = applyWorkbookOperation(scaled.value.nextWorkbook, {
      kind: 'resize-sheet-frame', operationId: 'resize-after-scale', sheetId: 'alpha', position: { x: 1, y: 2 }, size: { width: 320, height: 220 },
    });
    expect(resized).toMatchObject({ ok: true, value: { nextWorkbook: { documents: { alpha: { frame: { visualScale: 0.5 } } } } } });
    expect(applyWorkbookOperation(workbook, {
      kind: 'set-sheet-visual-scale', operationId: 'invalid-scale', sheetId: 'alpha', visualScale: Number.NaN,
    })).toEqual({ ok: false, reason: 'invalid-visual-scale' });
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
      kind: 'write-cells', operationId: 'write',
      writes: [write('alpha', cellIdentityAt(sheet.content, 'A1')!, raw)],
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
      kind: 'write-cells', operationId: 'write-1',
      writes: [write('alpha', a1, ''), write('alpha', b2, '=Beta!A1')],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        changed: true,
        calculationImpact: { kind: 'cells', cells: [{ sheetId: 'alpha', key: 'A1' }, { sheetId: 'alpha', key: 'B2' }] },
        persistence: { kind: 'write-cells', writes: [persistenceWrite('alpha', a1, 'old', null), persistenceWrite('alpha', b2, null, '=beta!@[beta:column:1,beta:row:1]')] },
        inverse: { kind: 'write-cells', writes: [write('alpha', a1, 'old'), write('alpha', b2, '')] },
      },
    });
    if (result.ok) {
      expect(cellRawContent(result.value.nextWorkbook.documents.alpha, 'A1')).toBeUndefined();
      expect(cellRawContent(result.value.nextWorkbook.documents.alpha, 'B2')).toBe('=beta!@[beta:column:1,beta:row:1]');
    }
  });

  it('applies changed cells across sheets in one transaction and its inverse restores exact raw content', () => {
    const source = workbookWithSheets([
      sheetDocument({ id: 'alpha', name: 'Alpha', cells: { A1: ' old value ' } }),
      sheetDocument({ id: 'beta', name: 'Beta', cells: { B2: '=alpha!@[alpha:column:1,alpha:row:1]' } }),
    ]);
    const alphaA1 = cellIdentityAt(source.documents.alpha.content, 'A1')!;
    const betaB2 = cellIdentityAt(source.documents.beta.content, 'B2')!;
    const result = applyWorkbookOperation(source, {
      kind: 'write-cells', operationId: 'cross-sheet',
      writes: [write('alpha', alphaA1, '=Beta!B2'), write('beta', betaB2, '')],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        calculationImpact: { kind: 'cells', cells: [{ sheetId: 'alpha', key: 'A1' }, { sheetId: 'beta', key: 'B2' }] },
        affected: { sheetIds: ['alpha', 'beta'], cells: [{ sheetId: 'alpha', cell: alphaA1 }, { sheetId: 'beta', cell: betaB2 }] },
        persistence: { kind: 'write-cells', writes: [
          persistenceWrite('alpha', alphaA1, ' old value ', '=beta!@[beta:column:2,beta:row:2]'),
          persistenceWrite('beta', betaB2, '=alpha!@[alpha:column:1,alpha:row:1]', null),
        ] },
        inverse: { kind: 'write-cells', writes: [
          write('alpha', alphaA1, ' old value '),
          write('beta', betaB2, '=alpha!@[alpha:column:1,alpha:row:1]'),
        ] },
      },
    });
    if (!result.ok || result.value.inverse?.kind !== 'write-cells') return;

    const restored = applyWorkbookOperation(result.value.nextWorkbook, {
      ...result.value.inverse, operationId: 'restore-cross-sheet',
    });
    expect(restored).toMatchObject({ ok: true, value: { nextWorkbook: source } });
  });

  it('records independent serializable state transitions for successive edits', () => {
    const source = workbookWithSheets([sheetDocument({ id: 'alpha', name: 'Alpha', cells: { A1: ' original ' } })]);
    const cell = cellIdentityAt(source.documents.alpha.content, 'A1')!;
    const first = applyWorkbookOperation(source, { kind: 'write-cells', operationId: 'first', writes: [write('alpha', cell, '=1+1')] });
    if (!first.ok || first.value.persistence?.kind !== 'write-cells') throw new Error('Expected first cell transition.');
    const firstPersistence = structuredClone(first.value.persistence);
    const second = applyWorkbookOperation(first.value.nextWorkbook, { kind: 'write-cells', operationId: 'second', writes: [write('alpha', cell, '')] });

    expect(first.value.persistence).toEqual(firstPersistence);
    expect(second).toMatchObject({ ok: true, value: { persistence: { kind: 'write-cells', writes: [persistenceWrite('alpha', cell, '=1+1', null)] } } });
    expect(JSON.parse(JSON.stringify(first.value.persistence))).toEqual(first.value.persistence);
  });

  it('replays a full content transaction only when every current value matches', () => {
    const source = workbookWithSheets([
      sheetDocument({ id: 'alpha', name: 'Alpha', cells: { A1: 'old' } }),
      sheetDocument({ id: 'beta', name: 'Beta', cells: { B2: '=alpha!A1' } }),
    ]);
    const alphaA1 = cellIdentityAt(source.documents.alpha.content, 'A1')!;
    const betaB2 = cellIdentityAt(source.documents.beta.content, 'B2')!;
    const applied = applyWorkbookOperation(source, {
      kind: 'write-cells', operationId: 'original',
      writes: [write('alpha', alphaA1, 'new'), write('beta', betaB2, '')],
    });
    if (!applied.ok || applied.value.persistence?.kind !== 'write-cells') throw new Error('Expected persisted cell writes.');

    const restored = replayCellPersistenceWrites(applied.value.nextWorkbook, applied.value.persistence.writes, 'after');
    expect(restored).toMatchObject({ ok: true, value: { nextWorkbook: source } });

    const modified = applyWorkbookOperation(applied.value.nextWorkbook, {
      kind: 'write-cells', operationId: 'intervening', writes: [write('alpha', alphaA1, 'later')],
    });
    if (!modified.ok) throw new Error('Expected intervening write.');
    expect(replayCellPersistenceWrites(modified.value.nextWorkbook, applied.value.persistence.writes, 'after'))
      .toEqual({ ok: false, reason: 'invalid-cell' });
    expect(cellRawContent(modified.value.nextWorkbook.documents.alpha, 'A1')).toBe('later');
  });

  it('omits effective no-op writes and emits nothing when every write is a no-op', () => {
    const source = workbookWithSheets([sheetDocument({ id: 'alpha', name: 'Alpha', cells: { A1: 'same' } }), beta]);
    const alphaA1 = cellIdentityAt(source.documents.alpha.content, 'A1')!;
    const alphaB2 = cellIdentityAt(source.documents.alpha.content, 'B2')!;
    const betaA1 = cellIdentityAt(source.documents.beta.content, 'A1')!;
    const mixed = applyWorkbookOperation(source, {
      kind: 'write-cells', operationId: 'mixed-no-ops',
      writes: [write('alpha', alphaA1, 'same'), write('alpha', alphaB2, ''), write('beta', betaA1, 'changed')],
    });
    expect(mixed).toMatchObject({
      ok: true,
      value: {
        persistence: { kind: 'write-cells', writes: [persistenceWrite('beta', betaA1, null, 'changed')] },
        inverse: { kind: 'write-cells', writes: [write('beta', betaA1, '')] },
        calculationImpact: { kind: 'cells', cells: [{ sheetId: 'beta', key: 'A1' }] },
      },
    });

    const noOps = applyWorkbookOperation(source, {
      kind: 'write-cells', operationId: 'all-no-ops',
      writes: [write('alpha', alphaA1, 'same'), write('alpha', alphaB2, '')],
    });
    expect(noOps).toMatchObject({
      ok: true,
      value: { nextWorkbook: source, changed: false, persistence: undefined, inverse: undefined, calculationImpact: { kind: 'none' } },
    });
  });

  it('rejects any invalid batch target before changing a valid target', () => {
    const source = workbookWithSheets([alpha, beta]);
    const result = applyWorkbookOperation(source, {
      kind: 'write-cells', operationId: 'write-2',
      writes: [write('alpha', cellIdentityAt(alpha.content, 'A1')!, 'valid'), write('alpha', { rowId: 'missing', columnId: 'missing' }, 'invalid')],
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-cell' });
    expect(source).toEqual(workbookWithSheets([alpha, beta]));
  });

  it.each([
    ['duplicate target', (source: Workbook) => {
      const cell = cellIdentityAt(source.documents.alpha.content, 'A1')!;
      return [write('alpha', cell, 'one'), write('alpha', cell, 'two')];
    }, 'duplicate-cell'],
    ['foreign cell identity', (source: Workbook) => [
      write('beta', cellIdentityAt(source.documents.alpha.content, 'A1')!, 'invalid'),
    ], 'invalid-cell'],
    ['unknown sheet after a valid target', (source: Workbook) => [
      write('alpha', cellIdentityAt(source.documents.alpha.content, 'A1')!, 'valid'),
      write('missing', { rowId: 'missing-row', columnId: 'missing-column' }, 'invalid'),
    ], 'unknown-sheet'],
  ])('rejects $label without changing any sheet', (_label, writes, reason) => {
    const source = workbookWithSheets([alpha, beta]);
    const before = structuredClone(source);
    expect(applyWorkbookOperation(source, {
      kind: 'write-cells', operationId: 'invalid-workbook-transaction', writes: writes(source),
    })).toEqual({ ok: false, reason });
    expect(source).toEqual(before);
  });

  it('uses plain serializable operation and persistence shapes', () => {
    const operation = {
      kind: 'write-cells', operationId: 'write-3',
      writes: [write('alpha', cellIdentityAt(alpha.content, 'A1')!, 'value')],
    } satisfies WorkbookOperation;
    const result = applyWorkbookOperation(workbook, operation);
    expect(JSON.parse(JSON.stringify(operation))).toEqual(operation);
    if (result.ok) expect(JSON.parse(JSON.stringify(result.value.persistence))).toEqual(result.value.persistence);
  });

  it.each([
    ['unknown sheet', { kind: 'delete-sheet', operationId: 'delete', sheetId: 'missing' } satisfies WorkbookOperation, 'unknown-sheet'],
    ['invalid cell', { kind: 'write-cells', operationId: 'write', writes: [write('alpha', { rowId: 'missing', columnId: 'missing' }, 'x')] } satisfies WorkbookOperation, 'invalid-cell'],
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

  it.each([
    ['an unknown visual scale sheet', { kind: 'set-sheet-visual-scale', operationId: 'scale', sheetId: 'missing', visualScale: 1 } satisfies WorkbookOperation, 'unknown-sheet'],
    ['an invalid visual scale', { kind: 'set-sheet-visual-scale', operationId: 'scale', sheetId: 'alpha', visualScale: Infinity } satisfies WorkbookOperation, 'invalid-visual-scale'],
    ['an unknown axis-size sheet', { kind: 'write-axis-sizes', operationId: 'sizes', sheetId: 'missing', writes: [] } satisfies WorkbookOperation, 'unknown-sheet'],
    ['an invalid axis-size identity', { kind: 'write-axis-sizes', operationId: 'sizes', sheetId: 'alpha', writes: [{ axis: 'row', axisId: 'missing', size: 20 }] } satisfies WorkbookOperation, 'invalid-axis-size'],
    ['an unknown z-order sheet', { kind: 'change-sheet-z-order', operationId: 'z', sheetId: 'missing', direction: 'top' } satisfies WorkbookOperation, 'unknown-sheet'],
  ])('rejects remaining invalid operation boundaries', (_label, action, reason) => {
    expect(applyWorkbookOperation(workbook, action as WorkbookOperation)).toEqual({ ok: false, reason });
  });

  it('rejects reconciliation for an unknown sheet', () => {
    expect(applyBackendWorkbookReconciliation(workbook, { kind: 'append-row', sheetId: 'missing', rowId: 'row' }))
      .toEqual({ ok: false, reason: 'unknown-sheet' });
  });

  it('leaves unchanged frame, scale, axis, and z-order operations as no-ops', () => {
    const rowId = alpha.content.rows[0]!;
    const unchanged = [
      { kind: 'move-sheet-frame', operationId: 'move', sheetId: 'alpha', position: alpha.frame.position },
      { kind: 'resize-sheet-frame', operationId: 'resize', sheetId: 'alpha', position: alpha.frame.position, size: alpha.frame.size },
      { kind: 'set-sheet-visual-scale', operationId: 'scale', sheetId: 'alpha', visualScale: alpha.frame.visualScale },
      { kind: 'write-axis-sizes', operationId: 'axis', sheetId: 'alpha', writes: [{ axis: 'row', axisId: rowId, size: null }] },
      { kind: 'change-sheet-z-order', operationId: 'z', sheetId: 'alpha', direction: 'bottom' },
    ] satisfies WorkbookOperation[];
    for (const operation of unchanged) {
      expect(applyWorkbookOperation(workbook, operation)).toMatchObject({ ok: true, value: { changed: false, nextWorkbook: workbook } });
    }
  });
});

describe('paste preparation', () => {
  it('materializes blanks and translates an internal canonical formula at its matching source coordinate', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', cells: { A1: '=B1', B1: '4' } });
    const destination = sheetDocument({ id: 'destination', name: 'Destination', cells: { B2: 'old' } });
    const sourceWorkbook = workbookWithSheets([source, destination]);
    const result = preparePasteCellWrites(
      sourceWorkbook,
      destination.id,
      cellIdentityAt(destination.content, 'B2')!,
      {
        ok: true,
        value: {
          kind: 'internal',
          grid: { rowCount: 1, columnCount: 2, rows: [['=B1', '']] },
          source: {
            sheetId: source.id,
            dimensions: { rowCount: 1, columnCount: 2 },
            cells: [[
              { identity: cellIdentityAt(source.content, 'A1')!, raw: '=@[source:column:2,source:row:1]' },
              { identity: cellIdentityAt(source.content, 'B1')!, raw: '' },
            ]],
          },
        },
      },
    );

    expect(result).toEqual({
      ok: true,
      writes: [
        write(destination.id, cellIdentityAt(destination.content, 'B2')!, '=@[destination:column:3,destination:row:2]'),
        write(destination.id, cellIdentityAt(destination.content, 'C2')!, ''),
      ],
    });
  });

  it('rejects an out-of-bounds footprint before generating a partial write', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
    const result = preparePasteCellWrites(workbookWithSheets([sheet]), sheet.id, cellIdentityAt(sheet.content, 'A1')!, {
      ok: true,
      value: { kind: 'external', grid: { rowCount: 1, columnCount: 2, rows: [['one', 'two']] } },
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-paste-footprint' });
  });

  it('rejects malformed parser output, invalid destinations, and invalid internal source snapshots before writing', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const workbook = workbookWithSheets([sheet]);
    const destination = cellIdentityAt(sheet.content, 'A1')!;
    const grid = { rowCount: 1, columnCount: 1, rows: [['value']] };

    expect(preparePasteCellWrites(workbook, sheet.id, destination, { ok: false, reason: 'malformed-tsv' }))
      .toEqual({ ok: false, reason: 'malformed-tsv' });
    expect(preparePasteCellWrites(workbook, 'missing', destination, { ok: true, value: { kind: 'external', grid } }))
      .toEqual({ ok: false, reason: 'invalid-destination' });
    expect(preparePasteCellWrites(workbook, sheet.id, destination, {
      ok: true, value: { kind: 'external', grid: { rowCount: 1, columnCount: 1, rows: [] } },
    })).toEqual({ ok: false, reason: 'invalid-paste-footprint' });
    expect(preparePasteCellWrites(workbook, sheet.id, destination, {
      ok: true,
      value: {
        kind: 'internal', grid,
        source: { sheetId: 'missing', dimensions: { rowCount: 1, columnCount: 1 }, cells: [[{ identity: destination, raw: 'value' }]] },
      },
    })).toEqual({ ok: false, reason: 'invalid-internal-source' });
    expect(preparePasteCellWrites(workbook, sheet.id, destination, {
      ok: true,
      value: {
        kind: 'internal', grid,
        source: { sheetId: sheet.id, dimensions: { rowCount: 2, columnCount: 1 }, cells: [[{ identity: destination, raw: 'value' }]] },
      },
    })).toEqual({ ok: false, reason: 'invalid-internal-source' });
    expect(preparePasteCellWrites(workbook, sheet.id, destination, {
      ok: true,
      value: {
        kind: 'internal', grid,
        source: {
          sheetId: sheet.id, dimensions: { rowCount: 1, columnCount: 1 },
          cells: [[{ identity: { rowId: 'missing-row', columnId: 'missing-column' }, raw: 'value' }]],
        },
      },
    })).toEqual({ ok: false, reason: 'invalid-internal-source' });
  });
});

describe('range move preparation', () => {
  const snapshot = (sheet: typeof alpha, start: string, rowCount = 1, columnCount = 1): ClipboardSourceSnapshot => {
    const origin = cellIdentityAt(sheet.content, start)!;
    const rowIndex = sheet.content.rows.indexOf(origin.rowId);
    const columnIndex = sheet.content.columns.indexOf(origin.columnId);
    const cells = Array.from({ length: rowCount }, (_, rowOffset) => Array.from({ length: columnCount }, (_, columnOffset) => {
      const identity = { rowId: sheet.content.rows[rowIndex + rowOffset]!, columnId: sheet.content.columns[columnIndex + columnOffset]! };
      return { identity, raw: sheet.content.cells[`${identity.rowId}\u0000${identity.columnId}`] ?? '' };
    }));
    return { sheetId: sheet.id, dimensions: { rowCount, columnCount }, cells };
  };

  it.each([
    ['left', { B1: 'one', C1: 'two', D1: 'three' }, 'B1', 'A1', 1, 2, ['A1', 'B1', 'C1'], ['one', 'two', '']],
    ['right', { A1: 'one', B1: 'two', C1: 'three' }, 'A1', 'B1', 1, 2, ['B1', 'C1', 'A1'], ['one', 'two', '']],
    ['up', { A2: 'one', A3: 'two', A4: 'three' }, 'A2', 'A1', 2, 1, ['A1', 'A2', 'A3'], ['one', 'two', '']],
    ['down', { A1: 'one', A2: 'two', A3: 'three' }, 'A1', 'A2', 2, 1, ['A2', 'A3', 'A1'], ['one', 'two', '']],
  ] as const)('handles %s overlap from a pre-move snapshot with unique final writes', (_direction, cells, source, destination, rowCount, columnCount, addresses, raws) => {
    const input = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 4, columnCount: 4, cells });
    const result = prepareMoveCellWrites(workbookWithSheets([input]), input.id, cellIdentityAt(input.content, destination)!, snapshot(input, source, rowCount, columnCount));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.writes).toEqual(addresses.map((address, index) => write(input.id, cellIdentityAt(input.content, address)!, raws[index]!)));
    expect(new Set(result.writes.map((item) => `${item.sheetId}:${item.rowId}:${item.columnId}`)).size).toBe(result.writes.length);
  });

  it('moves nonoverlapping ranges across sheets, retaining blanks, raw formulas, and stable identity mappings', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 3, columnCount: 3, cells: { A1: '=@[source:column:2,source:row:1]', B1: '' } });
    const destination = sheetDocument({ id: 'destination', name: 'Destination', rowCount: 3, columnCount: 3, cells: { B2: 'old', C2: 'replace' } });
    const sourceSnapshot = snapshot(source, 'A1', 1, 2);
    const result = prepareMoveCellWrites(workbookWithSheets([source, destination]), destination.id, cellIdentityAt(destination.content, 'B2')!, sourceSnapshot);
    expect(result).toEqual({
      ok: true,
      writes: [
        write(destination.id, cellIdentityAt(destination.content, 'B2')!, '=@[source:column:2,source:row:1]'),
        write(destination.id, cellIdentityAt(destination.content, 'C2')!, ''),
        write(source.id, cellIdentityAt(source.content, 'A1')!, ''),
        write(source.id, cellIdentityAt(source.content, 'B1')!, ''),
      ],
      mappings: [
        { source: { sheetId: source.id, cell: cellIdentityAt(source.content, 'A1')! }, destination: { sheetId: destination.id, cell: cellIdentityAt(destination.content, 'B2')! } },
        { source: { sheetId: source.id, cell: cellIdentityAt(source.content, 'B1')! }, destination: { sheetId: destination.id, cell: cellIdentityAt(destination.content, 'C2')! } },
      ],
    });
  });

  it('clears a nonoverlapping same-sheet source after writing its destination', () => {
    const input = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 4, cells: { A1: 'one', B1: 'two', C1: 'old', D1: 'old' } });
    const result = prepareMoveCellWrites(workbookWithSheets([input]), input.id, cellIdentityAt(input.content, 'C1')!, snapshot(input, 'A1', 1, 2));
    expect(result).toMatchObject({
      ok: true,
      writes: [
        write(input.id, cellIdentityAt(input.content, 'C1')!, 'one'),
        write(input.id, cellIdentityAt(input.content, 'D1')!, 'two'),
        write(input.id, cellIdentityAt(input.content, 'A1')!, ''),
        write(input.id, cellIdentityAt(input.content, 'B1')!, ''),
      ],
    });
  });

  it('reports a same-origin move as a successful no-op while retaining identity mappings', () => {
    const input = sheetDocument({ id: 'sheet', name: 'Sheet', cells: { A1: 'value' } });
    const result = prepareMoveCellWrites(workbookWithSheets([input]), input.id, cellIdentityAt(input.content, 'A1')!, snapshot(input, 'A1'));
    expect(result).toEqual({ ok: true, writes: [], mappings: [{ source: { sheetId: input.id, cell: cellIdentityAt(input.content, 'A1')! }, destination: { sheetId: input.id, cell: cellIdentityAt(input.content, 'A1')! } }] });
  });

  it('rejects malformed, stale, and unavailable inputs atomically without mutating workbook or snapshot', () => {
    const input = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2, cells: { A1: 'original' } });
    const workbook = workbookWithSheets([input]);
    const source = snapshot(input, 'A1');
    const originalWorkbook = structuredClone(workbook);
    const originalSnapshot = structuredClone(source);
    const changedWorkbook = structuredClone(workbook);
    changedWorkbook.documents.sheet.content.cells[`${input.content.rows[0]!}\u0000${input.content.columns[0]!}`] = 'changed';
    const malformed = { ...source, dimensions: { rowCount: 2, columnCount: 1 } };
    const missingCell = { ...source, cells: [[{ identity: { rowId: 'gone', columnId: 'gone' }, raw: 'original' }]] };

    expect(prepareMoveCellWrites(workbook, 'missing', cellIdentityAt(input.content, 'A1')!, source)).toEqual({ ok: false, reason: 'invalid-destination' });
    expect(prepareMoveCellWrites(workbook, input.id, { rowId: 'gone', columnId: 'gone' }, source)).toEqual({ ok: false, reason: 'invalid-destination' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'A1')!, { ...source, dimensions: { rowCount: 2, columnCount: 2 }, cells: [[source.cells[0]![0]!, source.cells[0]![0]!], [source.cells[0]![0]!, source.cells[0]![0]!]] })).toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'B2')!, malformed)).toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'B2')!, missingCell)).toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(prepareMoveCellWrites(changedWorkbook, input.id, cellIdentityAt(input.content, 'B2')!, source)).toEqual({ ok: false, reason: 'stale-move-source' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'B2')!, { ...source, sheetId: 'missing' })).toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(workbook).toEqual(originalWorkbook);
    expect(source).toEqual(originalSnapshot);
  });

  it('rejects noncontiguous snapshots, unsafe dimensions, and destination overflows', () => {
    const input = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 3, cells: { A1: 'one', B1: 'two', C1: 'three' } });
    const workbook = workbookWithSheets([input]);
    const source = snapshot(input, 'A1', 1, 2);
    const noncontiguous = structuredClone(source);
    noncontiguous.cells[0]![1]!.identity = cellIdentityAt(input.content, 'C1')!;

    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'A2')!, noncontiguous))
      .toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'A2')!, {
      ...source, dimensions: { rowCount: 1.5, columnCount: 2 },
    })).toEqual({ ok: false, reason: 'invalid-move-source' });
    expect(prepareMoveCellWrites(workbook, input.id, cellIdentityAt(input.content, 'C2')!, source))
      .toEqual({ ok: false, reason: 'invalid-move-footprint' });
  });
});
