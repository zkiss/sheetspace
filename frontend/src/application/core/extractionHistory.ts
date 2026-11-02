import type { Workbook, SheetDocument } from '@workbook/core/model';
import type { WorkbookPersistenceIntent } from './userActions';
import type { ContentTransaction } from './contentHistory';

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

function semantic(workbook: Workbook): Workbook {
  return { ...workbook, manifest: { ...workbook.manifest, revision: 0 }, documents: Object.fromEntries(Object.entries(workbook.documents).map(([id, sheet]) => [id, { ...sheet, revision: 0 }])) };
}

function protectedContent(sheet: SheetDocument) {
  return { ...sheet, frame: undefined, revision: 0 };
}

/** Prepare a compare-and-swap replay; the caller commits history only after persistence succeeds. */
export function prepareExtractionReplay(current: Workbook, transaction: ContentTransaction, direction: 'undo' | 'redo'): ExtractionReplayResult {
  if (transaction.kind !== 'extraction' || !transaction.snapshots) return { ok: false, reason: 'invalid-extraction-history' };
  const { before, after } = transaction.snapshots;
  if (!equal(before.dataModels, after.dataModels)) return { ok: false, reason: 'protected-model' };
  for (const id of new Set([...Object.keys(before.documents), ...Object.keys(after.documents)])) {
    const a = before.documents[id], b = after.documents[id];
    if ((a?.modelId || b?.modelId) && (!a || !b || !equal(protectedContent(a), protectedContent(b)))) return { ok: false, reason: 'protected-model' };
  }
  const expected = direction === 'undo' ? after : before;
  const target = direction === 'undo' ? before : after;
  if (!equal(semantic(current), semantic(expected))) return { ok: false, reason: 'stale-extraction-history' };
  const next = structuredClone(target);
  next.manifest.revision = current.manifest.revision;
  for (const [id, sheet] of Object.entries(next.documents)) sheet.revision = current.documents[id]?.revision ?? 0;
  return { ok: true, workbook: next, persistence: { kind: 'model-lifecycle', before: structuredClone(current), after: structuredClone(next) } };
}
