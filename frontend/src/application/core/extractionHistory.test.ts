import { describe, expect, it } from 'vitest';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { ContentHistory, CONTENT_HISTORY_MAX_BYTES, EXTRACTION_HISTORY_MAX_BYTES } from './contentHistory';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { calculatedProperty, declaration, modelWorkbook } from '@test-support/modelLifecycleFixtures';
import { extractSelection } from './extractSelection';
import { prepareExtractionReplay } from './extractionHistory';

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
  it('replays retargeted ordinary formulas on model sheets while protecting calculated cells', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1 });
    const model = sheetDocument({ id: 'modelSheet', name: 'ModelSheet', rowCount: 1, columnCount: 2 });
    source.frame.zIndex = 1; model.frame.zIndex = 2;
    model.modelId = 'model'; model.modelColumnBindings = { calc: model.content.columns[0]! };
    const before = modelWorkbook(declaration([calculatedProperty('calc', '=1')]), [source, model]);
    const cell = cellIdentityAt(source.content, 'A1')!;
    const ordinary = cellIdentityKey(cellIdentityAt(model.content, 'B1')!);
    model.content.cells[ordinary] = prepareUserFormula('=@Source!A[1]', before, model.id);
    const result = extractSelection(before, { sourceSheetId: source.id, selection: { kind: 'cells', start: cell, end: cell }, targetSheetId: ids[0]!, targetName: 'Target', targetRows: [ids[1]!], targetColumns: [ids[2]!], frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 2 } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.workbook.documents.modelSheet!.frame.zIndex).toBe(3);
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
    expect(redo.workbook).toEqual(after);
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

  it.each(['content', 'frame', 'model'] as const)('rejects stale %s changes without consuming history', (change) => {
    const { before, after } = extraction('cells'), history = new ContentHistory();
    history.recordExtraction(before, after);
    const current = structuredClone(after);
    if (change === 'content') current.documents.source!.content.cells.extra = 'other';
    if (change === 'frame') current.documents.source!.frame.position.x += 1;
    if (change === 'model') current.dataModels = { model: { id: 'model', name: 'Model', columns: [] } };
    expect(prepareExtractionReplay(current, history.peekUndo()!, 'undo')).toEqual({ ok: false, reason: 'stale-extraction-history' });
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
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
