import { expect, vi } from 'vitest';
import type { Workbook } from '@workbook/core/model';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { deleteRow } from '@application/core/deleteRow';
import type { WorkbookApi } from '@infrastructure/persistence/workbookApi';
import { persistedWorkbookClient } from './apiClients';
import { sheetDocument, workbookWithSheets } from './workbookFactories';

export function deletionFixture(sorting = false, prepared?: Workbook) {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 3, columnCount: 1, cells: { A1: '9', A2: '3', A3: '1' } });
  const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1 });
  const model = { id: 'model', name: 'Model', columns: [{ id: 'input', name: 'Input', kind: 'manual' as const, type: 'float' as const }] };
  const bound = bindSheetToModel({ ...workbookWithSheets([sheet, other]), dataModels: { model } }, 'sheet', 'model', () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  const target = bound.value.documents.sheet!;
  const initial: Workbook = prepared ?? { ...bound.value, documents: { ...bound.value.documents, sheet: { ...target,
    sorting: sorting ? [{ columnId: target.content.columns[0]!, direction: 'ascending' as const }] : undefined,
  } } };
  let current: Workbook = initial;
  let revision = 0;
  let loseResponse = false;
  let loseReplayResponse = false;
  const authorities = new Map<string, { sheetId: string; rowId: string; before: Workbook; after: Workbook }>();
  const captures = new Map<string, { request: Parameters<WorkbookApi['deleteRecord']>[2]; deletionId: string; sheetId: string; rowId: string }>();
  const replays = new Map<string, { sheetId: string; rowId: string; deletionId: string; request: Parameters<WorkbookApi['replayRecordDeletion']>[3] }>();
  const api = persistedWorkbookClient(initial);
  for (const method of Object.values(api)) method.mockImplementation(async () => { throw new Error('Unsupported deletion fixture operation'); });
  const adopt = (endpoint: Workbook) => {
    revision++;
    current = { ...endpoint, manifest: { ...endpoint.manifest, revision: current.manifest.revision }, documents: Object.fromEntries(
      Object.entries(endpoint.documents).map(([id, document]) => [id, { ...document, revision }]),
    ) };
    return current;
  };
  api.loadWorkbook.mockImplementation(async () => current);
  api.loadSheet.mockImplementation(async (id) => current.documents[id]!);
  api.saveModelLifecycle.mockImplementation(async (before: Workbook, after: Workbook) => {
    expect(before).toEqual(current);
    return adopt(structuredClone(after));
  });
  api.writeCells.mockImplementation(async (expected: Parameters<WorkbookApi['writeCells']>[0], writes: Parameters<WorkbookApi['writeCells']>[1]) => {
    for (const { sheetId, revision: expectedRevision } of expected) expect(current.documents[sheetId]!.revision).toBe(expectedRevision);
    const documents = { ...current.documents };
    for (const write of writes) {
      const document = documents[write.sheetId]!;
      const cells = { ...document.content.cells };
      if (write.raw === '') delete cells[cellIdentityKey(write)]; else cells[cellIdentityKey(write)] = write.raw;
      documents[write.sheetId] = { ...document, content: { ...document.content, cells } };
    }
    for (const { sheetId } of expected) documents[sheetId] = { ...documents[sheetId]!, revision: documents[sheetId]!.revision + 1 };
    current = { ...current, documents };
    return { sheets: expected.map(({ sheetId }) => ({ sheetId, revision: documents[sheetId]!.revision })) };
  });
  api.deleteRecord = vi.fn<WorkbookApi['deleteRecord']>(async (sheetId, rowId, request) => {
    const captured = captures.get(request.operationId);
    if (captured) {
      expect({ sheetId, rowId, request }).toEqual({ sheetId: captured.sheetId, rowId: captured.rowId, request: captured.request });
      return { operationId: request.operationId, rowId, deletionId: captured.deletionId, alreadyCommitted: true, workbook: current };
    }
    expect(request.before).toEqual(current);
    const deleted = deleteRow(current, sheetId, rowId);
    if (!deleted.ok) throw new Error(deleted.reason);
    const before = current;
    let after = deleted.value;
    for (const { sheetId: id, order } of request.rowOrders) {
      const document = after.documents[id]!;
      expect([...order].sort()).toEqual([...document.content.rows].sort());
      after = { ...after, documents: { ...after.documents, [id]: { ...document, content: { ...document.content, rows: [...order] } } } };
    }
    const deletionId = request.operationId;
    authorities.set(deletionId, { sheetId, rowId, before, after });
    captures.set(request.operationId, { sheetId, rowId, request: structuredClone(request), deletionId });
    adopt(after);
    if (loseResponse) { loseResponse = false; throw new Error('response lost after deletion committed'); }
    return { operationId: request.operationId, rowId, deletionId, alreadyCommitted: false, workbook: current };
  });
  api.replayRecordDeletion = vi.fn<WorkbookApi['replayRecordDeletion']>(async (sheetId, rowId, deletionId, request) => {
    const receipt = replays.get(request.operationId);
    if (receipt) {
      expect({ sheetId, rowId, deletionId, request }).toEqual(receipt);
      return { operationId: request.operationId, rowId, deletionId, alreadyCommitted: true, workbook: current };
    }
    const authority = authorities.get(deletionId);
    if (!authority) throw new Error('unknown deletion authority');
    expect({ sheetId, rowId }).toEqual({ sheetId: authority.sheetId, rowId: authority.rowId });
    expect(request.before).toEqual(current);
    expect(endpointContents(current)).toEqual(endpointContents(request.direction === 'undo' ? authority.after : authority.before));
    adopt(request.direction === 'undo' ? authority.before : authority.after);
    replays.set(request.operationId, structuredClone({ sheetId, rowId, deletionId, request }));
    if (loseReplayResponse) { loseReplayResponse = false; throw new Error('response lost after replay committed'); }
    return { operationId: request.operationId, rowId, deletionId, alreadyCommitted: false, workbook: current };
  });
  return { api, initial, rowId: target.content.rows[0]!, loseNextResponse: () => { loseResponse = true; },
    loseNextReplayResponse: () => { loseReplayResponse = true; } };
}

export function endpointContents(workbook: Workbook) {
  return { ...workbook, manifest: { ...workbook.manifest, revision: 0 }, documents: Object.fromEntries(
    Object.entries(workbook.documents).map(([id, document]) => [id, { ...document, revision: 0 }]),
  ) };
}
