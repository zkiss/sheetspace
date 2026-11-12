import type { Workbook, SheetDocument } from '@workbook/core/model';
import type { WorkbookPersistenceIntent } from './userActions';
import type { ContentTransaction } from './contentHistory';
import { calculatedOwnedColumns } from '@workbook/core/calculatedOwnership';
import { cellIdentityFromKey } from '@workbook/core/cellIdentity';

export type ExtractionReplayResult =
  | { ok: false; reason: 'invalid-extraction-history' | 'stale-extraction-history' | 'protected-model' }
  | { ok: true; workbook: Workbook; persistence: WorkbookPersistenceIntent };

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length && keys.every((key) => equal(a[key], b[key]));
}

export function semantic(workbook: Workbook): Workbook {
  return { ...workbook, manifest: { ...workbook.manifest, revision: 0 }, documents: Object.fromEntries(Object.entries(workbook.documents).map(([id, sheet]) => [id, { ...sheet, revision: 0 }])) };
}

export function replayDelta(current: unknown, expected: unknown, target: unknown): { ok: true; value: unknown } | { ok: false } {
  if (equal(expected, target)) return { ok: true, value: current };
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  if (object(expected) && object(target)) {
    if (!object(current)) return { ok: false };
    const result = { ...current };
    for (const key of new Set([...Object.keys(expected), ...Object.keys(target)])) {
      const child = replayDelta(current[key], expected[key], target[key]);
      if (!child.ok) return child;
      if (child.value === undefined) delete result[key]; else result[key] = child.value;
    }
    return { ok: true, value: result };
  }
  return equal(current, expected) ? { ok: true, value: structuredClone(target) } : { ok: false };
}

function protectedContent(sheet: SheetDocument, workbook: Workbook) {
  const owned = calculatedOwnedColumns(sheet, workbook.dataModels);
  const cells = Object.fromEntries(Object.entries(sheet.content.cells).filter(([key]) => {
    const identity = cellIdentityFromKey(key);
    return !identity || owned.has(identity.columnId);
  }));
  return { ...sheet, frame: undefined, revision: 0, content: { ...sheet.content, cells } };
}

function ordinaryChangesAreFormulaRewrites(a: SheetDocument, b: SheetDocument): boolean {
  return [...new Set([...Object.keys(a.content.cells), ...Object.keys(b.content.cells)])].every((key) => {
    const before = a.content.cells[key], after = b.content.cells[key];
    return before === after || (before?.startsWith('=') && after?.startsWith('='));
  });
}

/** Prepare a compare-and-swap replay; the caller commits history only after persistence succeeds. */
export function prepareExtractionReplay(current: Workbook, transaction: ContentTransaction, direction: 'undo' | 'redo'): ExtractionReplayResult {
  if (transaction.kind !== 'extraction' || !transaction.snapshots) return { ok: false, reason: 'invalid-extraction-history' };
  const { before, after } = transaction.snapshots;
  if (!equal(before.dataModels, after.dataModels)) return { ok: false, reason: 'protected-model' };
  for (const id of new Set([...Object.keys(before.documents), ...Object.keys(after.documents)])) {
    const a = before.documents[id], b = after.documents[id];
    if ((a?.modelId || b?.modelId) && (!a || !b || !equal(protectedContent(a, before), protectedContent(b, after)) || !ordinaryChangesAreFormulaRewrites(a, b))) return { ok: false, reason: 'protected-model' };
  }
  const expected = direction === 'undo' ? after : before;
  const target = direction === 'undo' ? before : after;
  const replayed = replayDelta(semantic(current), semantic(expected), semantic(target));
  if (!replayed.ok) return { ok: false, reason: 'stale-extraction-history' };
  const next = replayed.value as Workbook;
  next.manifest.revision = current.manifest.revision;
  for (const [id, sheet] of Object.entries(next.documents)) sheet.revision = current.documents[id]?.revision ?? 0;
  return { ok: true, workbook: next, persistence: { kind: 'model-lifecycle', before: structuredClone(current), after: structuredClone(next) } };
}
