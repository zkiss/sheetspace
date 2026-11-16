import { describe, expect, it } from 'vitest';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { ContentHistory, CONTENT_HISTORY_MAX_BYTES, EXTRACTION_HISTORY_MAX_BYTES } from './contentHistory';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { calculatedProperty, declaration, modelWorkbook } from '@test-support/modelLifecycleFixtures';
import { extractSelection } from './extractSelection';
import { prepareExtractionReplay, replayDelta, semantic } from './extractionHistory';

const ids = Array.from({ length: 8 }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`);
function extraction(kind: 'cells' | 'rows' | 'columns', all = false) {
  const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 2 });
  const before = workbookWithSheets([source]);
  const cell = cellIdentityAt(source.content, 'A1')!;
  source.content.cells[cellIdentityKey(cell)] = 'value';
  source.columnNames = { [cell.columnId]: 'Named' };
  source.presentation.rowHeights[cell.rowId] = 50;
  const selection = kind === 'cells' ? { kind, start: cell, end: cell } as const : kind === 'rows'
    ? { kind, start: source.content.rows[0]!, end: source.content.rows[all ? 1 : 0]! } as const
    : { kind, start: source.content.columns[0]!, end: source.content.columns[all ? 1 : 0]! } as const;
  const result = extractSelection(before, { sourceSheetId: source.id, selection, targetSheetId: ids[0]!, targetName: 'Target', targetRows: kind === 'columns' || all ? [ids[1]!, ids[2]!] : [ids[1]!], targetColumns: kind === 'rows' || all ? [ids[3]!, ids[4]!] : [ids[3]!], frame: { position: { x: 10, y: 20 }, size: { width: 100, height: 100 }, zIndex: 2 } });
  if (!result.ok) throw new Error(result.reason);
  return { before, after: result.workbook };
}

describe('extraction history', () => {
  it('normalizes empty metadata without discarding nonempty formatting or names', () => {
    const { after } = extraction('cells');
    const omitted = structuredClone(after);
    const empty = structuredClone(after);
    delete omitted.documents.source!.columnNames;
    delete omitted.documents.source!.presentation.formatOverrides;
    empty.documents.source!.columnNames = {};
    empty.documents.source!.presentation.formatOverrides = { rows: {}, columns: {}, cells: {} };
    expect(semantic(empty)).toEqual(semantic(omitted));
    empty.documents.source!.columnNames = { column: 'Amount' };
    empty.documents.source!.presentation.formatOverrides.cells.cell = { horizontalAlignment: 'right' };
    expect(semantic(empty).documents.source!.columnNames).toEqual({ column: 'Amount' });
    expect(semantic(empty).documents.source!.presentation.formatOverrides?.cells.cell).toEqual({ horizontalAlignment: 'right' });
  });

  it('preserves independent changes and rejects conflicts in a replay delta', () => {
    expect(replayDelta({ changed: 2, independent: 3 }, { changed: 2, independent: 1 }, { changed: 1, independent: 1 }))
      .toEqual({ ok: true, value: { changed: 1, independent: 3 } });
    expect(replayDelta({ changed: 4 }, { changed: 2 }, { changed: 1 })).toEqual({ ok: false });
  });

  it('allows undo after moving and resizing the extracted sheet but still rejects edited content', () => {
    const { before, after } = extraction('cells');
    const history = new ContentHistory();
    history.recordExtraction(before, after, ids[5]);
    const current = structuredClone(after);
    const target = current.documents[ids[0]!]!;
    target.frame.position = { x: 500, y: 600 };
    target.frame.size = { width: 400, height: 300 };
    expect(prepareExtractionReplay(current, history.peekUndo()!, 'undo', true).ok).toBe(true);
    target.content.cells[cellIdentityKey(cellIdentityAt(target.content, 'A1')!)] = 'changed';
    expect(prepareExtractionReplay(current, history.peekUndo()!, 'undo', true)).toEqual({ ok: false, reason: 'stale-extraction-history' });
  });
  it('rejects other changes to the extracted sheet after moving it', () => {
    const { before, after } = extraction('cells');
    const history = new ContentHistory();
    history.recordExtraction(before, after, ids[5]);
    const current = structuredClone(after);
    current.documents[ids[0]!]!.frame.position = { x: 500, y: 600 };
    current.documents[ids[0]!]!.name = 'Changed';
    expect(prepareExtractionReplay(current, history.peekUndo()!, 'undo', true)).toEqual({ ok: false, reason: 'stale-extraction-history' });
  });
  it('replays when persistence omits empty source formatting and target column names', () => {
    const extracted = extraction('cells');
    const before = structuredClone(extracted.before), after = structuredClone(extracted.after);
    const source = before.documents.source!;
    const identity = cellIdentityAt(source.content, 'A1')!;
    source.presentation.formatOverrides = { rows: {}, columns: {}, cells: { [cellIdentityKey(identity)]: { horizontalAlignment: 'right' } } };
    after.documents.source!.presentation.formatOverrides = { rows: {}, columns: {}, cells: {} };
    after.documents[ids[0]!]!.columnNames = {};
    const history = new ContentHistory();
    history.recordExtraction(before, after, ids[5]);
    const persisted = structuredClone(after);
    delete persisted.documents.source!.presentation.formatOverrides;
    delete persisted.documents[ids[0]!]!.columnNames;

    const undo = prepareExtractionReplay(persisted, history.peekUndo()!, 'undo', true);
    expect(undo.ok).toBe(true);
    if (!undo.ok) throw new Error(undo.reason);
    expect(undo.workbook.documents.source!.presentation.formatOverrides).toEqual(source.presentation.formatOverrides);
    history.commitUndo();
    const redo = prepareExtractionReplay(undo.workbook, history.peekRedo()!, 'redo', true);
    expect(redo.ok).toBe(true);
    if (!redo.ok) throw new Error(redo.reason);
    expect(redo.workbook.documents.source!.presentation.formatOverrides).toBeUndefined();
    expect(redo.workbook.documents[ids[0]!]!.columnNames).toBeUndefined();
  });

  it('undoes consecutive extractions of a formatted cell in reverse order', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1 });
    const cell = cellIdentityAt(source.content, 'A1')!;
    source.content.cells[cellIdentityKey(cell)] = '42';
    source.presentation.formatOverrides = { rows: {}, columns: {}, cells: { [cellIdentityKey(cell)]: { horizontalAlignment: 'right' } } };
    let current = workbookWithSheets([source]);
    let sourceId = source.id;
    const history = new ContentHistory();
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

    for (let index = 0; index < 3; index++) {
      const before = current;
      const identity = cellIdentityAt(before.documents[sourceId]!.content, 'A1')!;
      const targetId = uuid(index * 3 + 1);
      const result = extractSelection(before, { sourceSheetId: sourceId, selection: { kind: 'cells', start: identity, end: identity }, targetSheetId: targetId, targetName: `Target ${index}`, targetRows: [uuid(index * 3 + 2)], targetColumns: [uuid(index * 3 + 3)], frame: { position: { x: index * 200, y: 0 }, size: { width: 100, height: 100 }, zIndex: 1 } });
      if (!result.ok) throw new Error(result.reason);
      history.recordExtraction(before, result.workbook, uuid(index + 20));
      current = semantic(result.workbook);
      sourceId = targetId;
    }

    for (let index = 2; index >= 0; index--) {
      const undo = prepareExtractionReplay(current, history.peekUndo()!, 'undo', true);
      expect(undo.ok).toBe(true);
      if (!undo.ok) throw new Error(undo.reason);
      current = semantic(undo.workbook);
      history.commitUndo();
      expect(current.documents[uuid(index * 3 + 1)]).toBeUndefined();
    }
    expect(current.documents.source!.content.cells[cellIdentityKey(cell)]).toBe('42');
    expect(current.documents.source!.presentation.formatOverrides?.cells[cellIdentityKey(cell)]).toEqual({ horizontalAlignment: 'right' });
  });

  it.each([false, true])('accounts for the exact UTF-8 capacity boundary (online: %s)', (online) => {
    const { before, after } = extraction('cells');
    before.documents.source!.content.cells.padding = 'é';
    const sample = new ContentHistory();
    expect(sample.recordExtraction(before, after, online ? ids[5] : undefined).ok).toBe(true);
    const initialBytes = sample.peekUndo()!.bytes;
    before.documents.source!.content.cells.padding += 'x'.repeat(EXTRACTION_HISTORY_MAX_BYTES - initialBytes - (String(EXTRACTION_HISTORY_MAX_BYTES).length - String(initialBytes).length));
    const history = new ContentHistory();
    const prepared = history.prepareExtraction(before, after, online);
    expect(prepared).toBeDefined();
    prepared!(online ? ids[5] : undefined);
    const entry = history.peekUndo()!;
    expect(entry.bytes).toBe(EXTRACTION_HISTORY_MAX_BYTES);
    expect(entry.bytes).toBe(new TextEncoder().encode(JSON.stringify(entry)).byteLength);
    before.documents.source!.content.cells.padding += 'x';
    expect(new ContentHistory().prepareExtraction(before, after, online)).toBeUndefined();
  });
  it('preflights the complete UTF-8 representation and retains immutable bounded entries', () => {
    const { before, after } = extraction('cells');
    const history = new ContentHistory();
    const prepare = history.prepareExtraction(before, after, true)!;
    before.documents.source!.name = 'changed after preparation';
    expect(() => prepare('x'.repeat(37))).toThrow('Invalid extraction transition identity');
    prepare(ids[5]);
    prepare(ids[5]);
    const entry = history.peekUndo()!;
    expect(entry.snapshots!.before.documents.source!.name).toBe('Source');
    expect(entry.transitionId).toBe(ids[5]);
    expect(entry.bytes).toBe(new TextEncoder().encode(JSON.stringify(entry)).byteLength);
    expect(entry).not.toHaveProperty('extractionAfter');
    history.commitUndo();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.commitGuarded('redo', entry.identity + 1)).toBe(false);
    expect(history.commitGuarded('redo', entry.identity)).toBe(true);
  });

  it('rejects metadata overflow at the byte boundary without consuming redo', () => {
    const { before, after } = extraction('cells');
    const history = new ContentHistory();
    history.recordExtraction(before, after);
    history.commitUndo();
    const baseline = new ContentHistory();
    baseline.recordExtraction(before, after, ids[5]);
    const bytes = baseline.peekUndo()!.bytes;
    before.documents.source!.content.cells.padding = 'é' + 'x'.repeat(EXTRACTION_HISTORY_MAX_BYTES - bytes - 21);
    const exact = new ContentHistory();
    expect(exact.recordExtraction(before, after, ids[5]).ok).toBe(true);
    expect(exact.peekUndo()!.bytes).toBeLessThanOrEqual(EXTRACTION_HISTORY_MAX_BYTES);
    before.documents.source!.content.cells.padding += 'x'.repeat(EXTRACTION_HISTORY_MAX_BYTES - exact.peekUndo()!.bytes + 1);
    expect(new TextEncoder().encode(JSON.stringify({ before, after })).byteLength).toBeLessThan(EXTRACTION_HISTORY_MAX_BYTES);
    expect(history.prepareExtraction(before, after, true)).toBeUndefined();
    expect(history.canRedo).toBe(true);
  });

  it('retains authority with its extraction through undo and redo and rejects missing authority when required', () => {
    const { before, after } = extraction('cells');
    const history = new ContentHistory();
    history.recordExtraction(before, after, ids[5]);
    const undo = prepareExtractionReplay(after, history.peekUndo()!, 'undo', true);
    expect(undo.ok && undo.persistence).toMatchObject({ replay: { transitionId: ids[5], direction: 'undo' } });
    if (!undo.ok) throw new Error(undo.reason);
    history.commitUndo();
    const redo = prepareExtractionReplay(undo.workbook, history.peekRedo()!, 'redo', true);
    expect(redo.ok && redo.persistence).toMatchObject({ replay: { transitionId: ids[5], direction: 'redo' } });
    history.recordExtraction(before, after);
    expect(prepareExtractionReplay(after, history.peekUndo()!, 'undo', true)).toEqual({ ok: false, reason: 'missing-extraction-authority' });
  });
  it('replays retargeted ordinary formulas on model sheets while protecting calculated cells', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1 });
    const model = sheetDocument({ id: 'modelSheet', name: 'ModelSheet', rowCount: 1, columnCount: 2 });
    source.frame.zIndex = 1; model.frame.zIndex = 1;
    model.modelId = 'model'; model.modelColumnBindings = { calc: model.content.columns[0]! };
    const before = modelWorkbook(declaration([calculatedProperty('calc', '=1')]), [source, model]);
    const cell = cellIdentityAt(source.content, 'A1')!;
    const ordinary = cellIdentityKey(cellIdentityAt(model.content, 'B1')!);
    model.content.cells[ordinary] = prepareUserFormula('=@Source!A[1]', before, model.id);
    const result = extractSelection(before, { sourceSheetId: source.id, selection: { kind: 'cells', start: cell, end: cell }, targetSheetId: ids[0]!, targetName: 'Target', targetRows: [ids[1]!], targetColumns: [ids[2]!], frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 2 } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.workbook.documents.modelSheet!.frame.zIndex).toBe(2);
    expect(result.workbook.dataModels).toEqual(before.dataModels);
    expect(result.workbook.documents.modelSheet!.content.cells[ordinary]).not.toEqual(model.content.cells[ordinary]);
    const history = new ContentHistory(); history.recordExtraction(before, result.workbook);
    const undo = prepareExtractionReplay(result.workbook, history.peekUndo()!, 'undo');
    expect(undo.ok).toBe(true); if (!undo.ok) return;
    expect(undo.workbook).toEqual(before); history.commitUndo();
    const redo = prepareExtractionReplay(undo.workbook, history.peekRedo()!, 'redo');
    expect(redo.ok && redo.workbook).toEqual(result.workbook);
    const changed = structuredClone(result.workbook);
    changed.documents.modelSheet!.content.cells[cellIdentityKey(cellIdentityAt(model.content, 'A1')!)] = '=2';
    history.recordExtraction(before, changed);
    expect(prepareExtractionReplay(changed, history.peekUndo()!, 'undo')).toEqual({ ok: false, reason: 'protected-model' });
  });

  it('permits model-bound row ordering while rejecting structural row changes', () => {
    const { before, after } = extraction('cells');
    const model = sheetDocument({ id: 'modelSheet', name: 'Model', rowCount: 2, columnCount: 1 });
    model.modelId = 'model';
    model.sorting = [{ columnId: model.content.columns[0]!, direction: 'ascending' }];
    before.documents.modelSheet = structuredClone(model);
    after.documents.modelSheet = structuredClone(model);
    after.documents.modelSheet.content.rows.reverse();
    const history = new ContentHistory();
    history.recordExtraction(before, after);
    expect(prepareExtractionReplay(after, history.peekUndo()!, 'undo').ok).toBe(true);
    const changed = structuredClone(after);
    changed.documents.modelSheet!.content.rows[0] = 'unexpected';
    history.recordExtraction(before, changed);
    expect(prepareExtractionReplay(changed, history.peekUndo()!, 'undo')).toEqual({ ok: false, reason: 'protected-model' });
  });

  it('bounds snapshot retention, rejects oversized admission without consuming redo, and replays retained entries', () => {
    const { before, after } = extraction('cells');
    before.documents.source!.content.cells.large = 'x'.repeat(3 * 1024 * 1024);
    after.documents.source!.content.cells.large = before.documents.source!.content.cells.large!;
    const history = new ContentHistory();
    expect(history.canRecordExtraction(before, after)).toBe(true);
    expect(history.recordExtraction(before, after)).toEqual({ ok: true });
    expect(history.recordExtraction(before, after)).toEqual({ ok: true });
    expect(history.recordExtraction(before, after)).toEqual({ ok: true });
    history.commitUndo(); history.commitUndo();
    expect(history.canUndo).toBe(false);
    expect(prepareExtractionReplay(before, history.peekRedo()!, 'redo').ok).toBe(true);
    const huge = structuredClone(before);
    huge.documents.source!.content.cells.large = 'x'.repeat(EXTRACTION_HISTORY_MAX_BYTES);
    expect(history.canRecordExtraction(huge, after)).toBe(false);
    expect(history.recordExtraction(huge, after)).toEqual({ ok: false, reason: 'extraction-history-too-large' });
    expect(history.canRedo).toBe(true);
    history.commitRedo();
    expect(prepareExtractionReplay(after, history.peekUndo()!, 'undo').ok).toBe(true);
  });
  it.each([['cells', false], ['rows', false], ['columns', false], ['rows', true], ['columns', true]] as const)('replays %s extraction (all=%s) with stable identities and metadata', (kind, all) => {
    const { before, after } = extraction(kind, all), history = new ContentHistory();
    history.recordExtraction(before, after);
    const undo = prepareExtractionReplay(after, history.peekUndo()!, 'undo');
    expect(undo.ok).toBe(true); if (!undo.ok) return;
    expect(undo.workbook).toEqual(before);
    history.commitUndo();
    const redo = prepareExtractionReplay(undo.workbook, history.peekRedo()!, 'redo');
    expect(redo.ok).toBe(true); if (!redo.ok) return;
    expect(semantic(redo.workbook)).toEqual(semantic(after));
    expect(redo.persistence.kind).toBe('model-lifecycle');
  });

  it('retains large immutable extraction snapshots and orders cell edits ahead of them', () => {
    const { before, after } = extraction('cells');
    before.documents.source!.content.cells.large = 'x'.repeat(CONTENT_HISTORY_MAX_BYTES);
    after.documents.source!.content.cells.large = before.documents.source!.content.cells.large!;
    const history = new ContentHistory();
    history.recordExtraction(before, after);
    history.record([{ sheetId: 'source', rowId: 'r', columnId: 'c', beforeRaw: null, afterRaw: 'x' }], { sheetIds: ['source'], cells: [] });
    expect(history.peekUndo()!.kind).toBe('cells');
    history.commitUndo();
    const snapshot = history.peekUndo()!;
    snapshot.snapshots!.before.documents.source!.name = 'mutated';
    expect(history.peekUndo()!.snapshots!.before.documents.source!.name).toBe('Source');
    expect(prepareExtractionReplay(after, history.peekUndo()!, 'undo').ok).toBe(true);
    history.commitUndo();
    history.recordExtraction(before, after);
    expect(history.canRedo).toBe(false);
  });

  it('treats an oversized cell edit as a history boundary after extraction and cell edits', () => {
    const { before, after } = extraction('cells'), history = new ContentHistory();
    const cell = cellIdentityAt(after.documents.source!.content, 'A1')!;
    const affected = { sheetIds: ['source'], cells: [{ sheetId: 'source', cell }] };
    const write = (beforeRaw: string | null, afterRaw: string) => ({ sheetId: 'source', ...cell, beforeRaw, afterRaw });
    history.recordExtraction(before, after);
    history.record([write(null, 'small')], affected);

    const large = 'x'.repeat(CONTENT_HISTORY_MAX_BYTES);
    history.record([write('small', large)], affected);

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    history.record([{ ...write(null, 'next'), columnId: 'another-column' }], { sheetIds: ['source'], cells: [] });
    expect(history.peekUndo()?.writes[0]?.afterRaw).toBe('next');
    history.commitUndo();
    expect(history.canUndo).toBe(false);
  });

  it('clears both redo and older extraction undo after an oversized cell edit', () => {
    const { before, after } = extraction('cells'), history = new ContentHistory();
    history.recordExtraction(before, after);
    history.record([{ sheetId: 'source', rowId: 'r', columnId: 'c', beforeRaw: null, afterRaw: 'small' }], { sheetIds: ['source'], cells: [] });
    history.commitUndo();

    history.record([{ sheetId: 'source', rowId: 'r', columnId: 'c', beforeRaw: null, afterRaw: 'x'.repeat(CONTENT_HISTORY_MAX_BYTES) }], { sheetIds: ['source'], cells: [] });

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it.each(['content', 'frame', 'model'] as const)('preserves unrelated %s changes across replay', (change) => {
    const { before, after } = extraction('cells'), history = new ContentHistory();
    history.recordExtraction(before, after);
    const current = structuredClone(after);
    if (change === 'content') current.documents.source!.content.cells.extra = 'other';
    if (change === 'frame') current.documents.source!.frame.position.x += 1;
    if (change === 'model') current.dataModels = { model: { id: 'model', name: 'Model', columns: [] } };
    const undo = prepareExtractionReplay(current, history.peekUndo()!, 'undo');
    expect(undo.ok).toBe(true); if (!undo.ok) return;
    history.commitUndo();
    const redo = prepareExtractionReplay(undo.workbook, history.peekRedo()!, 'redo');
    expect(redo.ok).toBe(true); if (!redo.ok) return;
    expect(redo.workbook).toEqual(current);
  });

  it('preserves independently edited functions instead of replaying captured binding changes', () => {
    const { before, after } = extraction('cells'), history = new ContentHistory();
    before.functions = [{ name: 'F', parameters: [], body: '=1', bodyBindings: { source: '=1' as never } }];
    after.functions = [{ name: 'F', parameters: [], body: '=1', bodyBindings: { source: '=2' as never } }];
    history.recordExtraction(before, after, ids[5]);
    const current = structuredClone(after);
    current.functions = [{ name: 'F', parameters: [], body: '=3', bodyBindings: { source: '=3' as never } }, { name: 'G', parameters: [], body: '=4' }];

    const undo = prepareExtractionReplay(current, history.peekUndo()!, 'undo', true);

    expect(undo.ok).toBe(true); if (!undo.ok) return;
    expect(undo.workbook.functions).toEqual(current.functions);
    expect(undo.persistence).toMatchObject({ replay: { transitionId: ids[5], direction: 'undo' } });
    history.commitUndo();
    const redo = prepareExtractionReplay(undo.workbook, history.peekRedo()!, 'redo', true);
    expect(redo.ok && redo.workbook.functions).toEqual(current.functions);
  });

  it('rejects stale extraction-owned cells despite independent function edits', () => {
    const { before, after } = extraction('cells'), history = new ContentHistory();
    history.recordExtraction(before, after, ids[5]);
    const current = structuredClone(after);
    current.functions = [{ name: 'F', parameters: [], body: '=3' }];
    const target = current.documents[ids[0]!]!;
    target.content.cells[cellIdentityKey(cellIdentityAt(target.content, 'A1')!)] = 'overlap';

    expect(prepareExtractionReplay(current, history.peekUndo()!, 'undo', true)).toEqual({ ok: false, reason: 'stale-extraction-history' });
    expect(history.canUndo).toBe(true);
  });

  it('preserves live opposite-axis order, sizes and formats while reverting extraction-owned cells', () => {
    const { before, after } = extraction('cells'), history = new ContentHistory();
    history.recordExtraction(before, after);
    const current = structuredClone(after);
    const source = current.documents.source!;
    source.content.rows.reverse();
    source.content.columns.reverse();
    source.content.cells.extra = 'unrelated';
    source.presentation.rowHeights[source.content.rows[0]!] = 77;
    source.presentation.columnWidths[source.content.columns[0]!] = 150;
    source.presentation.formatOverrides = { rows: {}, columns: {}, cells: { extra: { fontWeight: 'bold' } } };
    source.frame.position.x = 123;
    current.dataModels = { model: { id: 'model', name: 'Model', columns: [] } };
    const undo = prepareExtractionReplay(current, history.peekUndo()!, 'undo');
    expect(undo.ok).toBe(true); if (!undo.ok) return;
    expect(undo.workbook.documents[ids[0]!]).toBeUndefined();
    expect(undo.workbook.documents.source!.content.cells.extra).toBe('unrelated');
    expect(undo.workbook.documents.source!.content.rows).toEqual(source.content.rows);
    expect(undo.workbook.documents.source!.content.columns).toEqual(source.content.columns);
    expect(undo.workbook.documents.source!.presentation).toEqual(source.presentation);
    expect(undo.workbook.documents.source!.frame).toEqual(source.frame);
    expect(undo.workbook.dataModels).toEqual(current.dataModels);
    history.commitUndo();
    const redo = prepareExtractionReplay(undo.workbook, history.peekRedo()!, 'redo');
    expect(redo.ok && redo.workbook).toEqual(current);
  });

  it('rejects changes to extraction-owned values without consuming history', () => {
    const { before, after } = extraction('cells'), history = new ContentHistory();
    history.recordExtraction(before, after);
    const current = structuredClone(after);
    current.documents[ids[0]!]!.name = 'changed';
    expect(prepareExtractionReplay(current, history.peekUndo()!, 'undo')).toEqual({ ok: false, reason: 'stale-extraction-history' });
    expect(history.canUndo).toBe(true);
  });

  it('uses live revisions rather than historic counters for replay', () => {
    const { before, after } = extraction('cells'), history = new ContentHistory();
    history.recordExtraction(before, after);
    const current = structuredClone(after);
    current.manifest.revision = 22; current.documents.source!.revision = 17;
    const undo = prepareExtractionReplay(current, history.peekUndo()!, 'undo');
    expect(undo.ok).toBe(true); if (!undo.ok) return;
    expect(undo.workbook.manifest.revision).toBe(22);
    expect(undo.workbook.documents.source!.revision).toBe(17);
  });

  it('rejects modified model declarations and protected model contents', () => {
    const { before, after } = extraction('cells'), history = new ContentHistory();
    const changedModel = structuredClone(after);
    changedModel.dataModels = { m: { id: 'm', name: 'M', columns: [] } };
    history.recordExtraction(before, changedModel);
    expect(prepareExtractionReplay(changedModel, history.peekUndo()!, 'undo')).toEqual({ ok: false, reason: 'protected-model' });
    const modelBefore = structuredClone(before), modelAfter = structuredClone(after);
    modelBefore.documents.source!.modelId = 'm'; modelAfter.documents.source!.modelId = 'm';
    history.recordExtraction(modelBefore, modelAfter);
    expect(prepareExtractionReplay(modelAfter, history.peekUndo()!, 'undo')).toEqual({ ok: false, reason: 'protected-model' });
  });

  it('rejects cell transactions as snapshot replay', () => {
    const { after } = extraction('cells'), history = new ContentHistory();
    history.record([], { sheetIds: [], cells: [] });
    expect(prepareExtractionReplay(after, history.peekUndo()!, 'undo')).toEqual({ ok: false, reason: 'invalid-extraction-history' });
  });
});
