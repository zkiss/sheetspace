import type { CustomFunction, SheetDocument, Workbook } from '@workbook/core/model';
import { requireStoredFormula } from '@workbook/formula/storedFormula';
import { modelBindingError } from '@workbook/core/modelBindingValidation';

export type CreationReconciliationInput = {
  baseline: Workbook;
  current: Workbook;
  receipt: { sheetId: string; workbook: Workbook };
  revisions: Readonly<Record<string, number>>;
};
export type CreationReconciliationResult =
  | { ok: true; workbook: Workbook; created: SheetDocument; revisions: { sheetId: string; revision: number }[] }
  | { ok: false; reason: 'conflict' | 'stale' | 'recovery-required' };

type Failure = Extract<CreationReconciliationResult, { ok: false }>;
const conflict: Failure = { ok: false, reason: 'conflict' };
const recovery: Failure = { ok: false, reason: 'recovery-required' };

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const keys = Object.keys(x).filter((key) => x[key] !== undefined);
  return keys.length === Object.keys(y).filter((key) => y[key] !== undefined).length && keys.every((key) => equal(x[key], y[key]));
}

function merge<T>(base: T, current: T, server: T): { ok: true; value: T } | Failure {
  if (equal(current, base)) return { ok: true, value: server };
  if (equal(server, base) || equal(current, server)) return { ok: true, value: current };
  return conflict;
}

function content(sheet: SheetDocument | undefined) {
  if (!sheet) return undefined;
  return { ...sheet, revision: undefined };
}

function structure(sheet: SheetDocument) {
  return { name: sheet.name, rows: sheet.content.rows, columns: sheet.content.columns, columnNames: sheet.columnNames, modelId: sheet.modelId, modelColumnBindings: sheet.modelColumnBindings };
}

function source(fn: CustomFunction | undefined) {
  if (!fn) return undefined;
  return { ...fn, bodyBindings: undefined };
}

function key(fn: CustomFunction) { return fn.identity ? `id:${fn.identity}` : `name:${fn.name.toUpperCase()}`; }

function mergeFunctions(base: Workbook, current: Workbook, server: Workbook, sheetIds: readonly string[], createdId: string): { ok: true; value: CustomFunction[] } | Failure {
  const maps = [base, current, server].map((workbook) => new Map((workbook.functions ?? []).map((fn) => [key(fn), fn])));
  if (maps.some((map, i) => map.size !== ([base, current, server][i].functions ?? []).length)) return conflict;
  const [b, c, s] = maps;
  const result: CustomFunction[] = [];
  for (const id of new Set([...b.keys(), ...c.keys(), ...s.keys()])) {
    const before = b.get(id), local = c.get(id), remote = s.get(id);
    const declaration = merge(source(before), source(local), source(remote));
    if (!declaration.ok) return declaration;
    if (!declaration.value) continue;
    const selected = [local, remote, before].find((fn) => equal(source(fn), declaration.value));
    if (!selected) return conflict;
    const bindings: Record<string, NonNullable<CustomFunction['bodyBindings']>[string]> = {};
    for (const sheetId of sheetIds) {
      const binding = merge(before?.bodyBindings?.[sheetId], local?.bodyBindings?.[sheetId], remote?.bodyBindings?.[sheetId]);
      if (!binding.ok) return binding;
      if (binding.value !== undefined) {
        try { bindings[sheetId] = requireStoredFormula(binding.value); } catch { return recovery; }
      } else if (selected.body.startsWith('=')) return recovery;
    }
    if (selected.body.startsWith('=') && (!equal(source(remote), declaration.value) || remote?.bodyBindings?.[createdId] === undefined)) return recovery;
    result.push({ ...selected, bodyBindings: bindings });
  }
  if (new Set(result.map((fn) => fn.name.toUpperCase())).size !== result.length) return conflict;
  return { ok: true, value: result };
}

export function reconcileSheetCreation({ baseline, current, receipt, revisions }: CreationReconciliationInput): CreationReconciliationResult {
  const server = receipt.workbook, id = receipt.sheetId;
  if (baseline.documents[id] || current.documents[id] || revisions[id] !== undefined || !server.documents[id]) return { ok: false, reason: 'stale' };
  const documents: Workbook['documents'] = {};
  for (const sheetId of new Set([...Object.keys(baseline.documents), ...Object.keys(current.documents), ...Object.keys(server.documents)])) {
    const b = baseline.documents[sheetId], c = current.documents[sheetId], s = server.documents[sheetId];
    if (sheetId === id) { documents[id] = s; continue; }
    if (!b && !c) return recovery;
    const chosen = merge(content(b), content(c), content(s));
    if (!chosen.ok) return chosen;
    if (!chosen.value) continue;
    const selected = [c, s, b].find((sheet) => equal(content(sheet), chosen.value));
    if (!selected) return conflict;
    if (selected === s && s && s.revision < Math.max(c?.revision ?? 0, revisions[sheetId] ?? 0) && !equal(content(c), content(s))) return { ok: false, reason: 'stale' };
    documents[sheetId] = { ...selected, revision: Math.max(selected.revision, c?.revision ?? 0, s?.revision ?? 0, revisions[sheetId] ?? 0) };
  }
  const sheetIds = [...current.manifest.sheetIds.filter((sheetId) => documents[sheetId]), ...server.manifest.sheetIds.filter((sheetId) => documents[sheetId] && !current.manifest.sheetIds.includes(sheetId))];
  if (sheetIds.length !== Object.keys(documents).length || new Set(sheetIds).size !== sheetIds.length) return conflict;
  if (new Set(Object.values(documents).map((sheet) => sheet.name)).size !== sheetIds.length
    || Object.entries(documents).some(([sheetId, sheet]) => sheet.id !== sheetId
      || new Set(sheet.content.rows).size !== sheet.content.rows.length
      || new Set(sheet.content.columns).size !== sheet.content.columns.length)) return conflict;
  const models = merge(baseline.dataModels ?? {}, current.dataModels ?? {}, server.dataModels ?? {});
  if (!models.ok) return models;
  if (Object.values(documents).some((sheet) => modelBindingError(sheet, models.value))) return recovery;
  if ((server.functions ?? []).some((fn) => fn.body.startsWith('=')) && !equal(models.value, server.dataModels ?? {})) return recovery;
  if ((server.functions ?? []).some((fn) => fn.body.startsWith('=')) && sheetIds.some((sheetId) => {
    const local = documents[sheetId], remote = server.documents[sheetId];
    return remote && !equal(structure(local), structure(remote));
  })) return recovery;
  const functions = mergeFunctions(baseline, current, server, sheetIds, id);
  if (!functions.ok) return functions;
  const workbook: Workbook = { ...current, manifest: { ...current.manifest, revision: Math.max(current.manifest.revision, server.manifest.revision), sheetIds }, documents, dataModels: models.value, functions: functions.value };
  return { ok: true, workbook, created: documents[id], revisions: Object.values(documents).map((sheet) => ({ sheetId: sheet.id, revision: sheet.revision })) };
}
