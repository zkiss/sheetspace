import { describe, expect, it } from 'vitest';
import type { CustomFunction, SheetDocument, Workbook } from '@workbook/core/model';
import { requireStoredFormula } from '@workbook/formula/storedFormula';
import { reconcileSheetCreation } from './creationReconciliation';
import { decodeWorkbookBundle, encodeWorkbookBundle } from '@infrastructure/persistence/workbookApi';

function sheet(id: string): SheetDocument {
  return { id, name: id, revision: 1, frame: { position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, visualScale: 1, zIndex: 1 }, presentation: { rowHeights: {}, columnWidths: {} }, content: { kind: 'tabular', rows: ['row'], columns: ['column'], cells: {} } };
}
function book(ids: string[], functions: CustomFunction[] = []): Workbook {
  return { manifest: { version: 1, revision: 1, sheetIds: ids }, documents: Object.fromEntries(ids.map((id) => [id, sheet(id)])), functions };
}
function fn(bindings: Record<string, string>, body = '=BROKEN('): CustomFunction {
  return { identity: 'f', name: 'custom', parameters: [], body, bodyBindings: Object.fromEntries(Object.entries(bindings).map(([id, value]) => [id, requireStoredFormula(value)])) };
}
function settle(baseline: Workbook, current: Workbook, server: Workbook, sheetId = 'new', revisions: Record<string, number> = {}) {
  return reconcileSheetCreation({ baseline, current, receipt: { sheetId, workbook: server }, revisions });
}

describe('creation receipt reconciliation', () => {
  it('requires recovery when a receipt contains another server-only sheet', () => {
    const base = book(['old'], [fn({ old: '=old' })]);
    const firstReceipt = book(['old', 'new', 'other'], [fn({ old: '=old', new: '=new', other: '=other' })]);
    const original = structuredClone([base, firstReceipt]);
    const first = settle(base, base, firstReceipt);
    expect(first).toEqual({ ok: false, reason: 'recovery-required' });
    expect([base, firstReceipt]).toEqual(original);
  });
  it('rejects individually valid model and document changes that merge incompatibly', () => {
    const base = book(['old']);
    base.dataModels = { model: { id: 'model', name: 'Model', columns: [{ id: 'property', name: 'Property', kind: 'manual', type: 'string' }] } };
    const current = structuredClone(base);
    current.dataModels = { model: { ...base.dataModels.model, columns: [] } };
    const server = structuredClone(base);
    server.documents.new = sheet('new');
    server.manifest.sheetIds.push('new');
    server.documents.old.modelId = 'model';
    server.documents.old.modelColumnBindings = { property: 'column' };
    for (const workbook of [base, current, server]) expect(() => decodeWorkbookBundle(encodeWorkbookBundle(workbook))).not.toThrow();
    const saved = structuredClone([base, current, server]);
    expect(settle(base, current, server)).toEqual({ ok: false, reason: 'recovery-required' });
    expect([base, current, server]).toEqual(saved);
  });
  it('installs server-only function and changed structural axes together', () => {
    const base = book(['old']);
    const server = book(['old', 'new'], [fn({ old: '=old', new: '=new' })]);
    server.documents.old.content.rows = ['server-row'];
    const result = settle(base, base, server);
    expect(result.ok && result.workbook.documents.old.content.rows).toEqual(['server-row']);
    expect(result.ok && result.workbook.functions).toEqual(server.functions);
  });
  it('preserves local edits and removals while admitting compatible authoritative bindings', () => {
    const base = book(['old', 'removed'], [fn({ old: '=old', removed: '=removed' })]);
    const current = structuredClone(base);
    current.documents.old.content.cells.x = 'changed';
    current.documents.old.frame.position.x = 3;
    delete current.documents.removed;
    current.manifest.sheetIds = ['old'];
    const server = book(['old', 'removed', 'new'], [fn({ old: '=old', removed: '=removed', new: '=new' })]);
    const result = settle(base, current, server);
    expect(result.ok && result.workbook.documents.old).toEqual(current.documents.old);
    expect(result.ok && result.workbook.functions?.[0].bodyBindings).toEqual({ old: '=old', new: '=new' });
    expect(result.ok && result.workbook.manifest.sheetIds).toEqual(['old', 'new']);
  });
  it('merges reversed creation bindings without rolling back revisions', () => {
    const base = book(['old'], [fn({ old: '=old' })]);
    const current = book(['old', 'second'], [fn({ old: '=old', second: '=second' })]);
    const server = book(['old', 'new'], [fn({ old: '=old', new: '=new' })]);
    const result = settle(base, current, server, 'new', { old: 8 });
    expect(result.ok && result.workbook.functions?.[0].bodyBindings).toEqual({ old: '=old', second: '=second', new: '=new' });
    expect(result.ok && result.workbook.documents.old.revision).toBe(8);
  });
  it('does not overwrite locally deleted or changed definitions', () => {
    const base = book(['old'], [fn({ old: '=old' })]);
    const server = book(['old', 'new'], [fn({ old: '=old', new: '=new' })]);
    const deleted = book(['old']);
    expect(settle(base, deleted, server)).toMatchObject({ ok: true, workbook: { functions: [] } });
    const changed = book(['old'], [fn({ old: '=changed' }, '=NEW(')]);
    expect(settle(base, changed, server)).toEqual({ ok: false, reason: 'recovery-required' });
  });
  it('rejects overlapping content and binding changes without mutation', () => {
    const base = book(['old'], [fn({ old: '=old' })]);
    const current = structuredClone(base), server = book(['old', 'new'], [fn({ old: '=server', new: '=new' })]);
    current.functions = [fn({ old: '=local' })];
    const saved = structuredClone([base, current, server]);
    expect(settle(base, current, server)).toEqual({ ok: false, reason: 'conflict' });
    expect([base, current, server]).toEqual(saved);
    current.functions = base.functions;
    current.documents.old.content.rows = ['local'];
    server.documents.old.content.rows = ['server'];
    expect(settle(base, current, server)).toEqual({ ok: false, reason: 'conflict' });
  });
  it('rejects duplicate identities and stale remote document replacements', () => {
    const base = book(['old']), server = book(['old', 'new']);
    expect(settle(server, server, server)).toEqual({ ok: false, reason: 'stale' });
    server.documents.old.name = 'server';
    expect(settle(base, base, server, 'new', { old: 5 })).toEqual({ ok: false, reason: 'stale' });
  });
  it('requires recovery for changed structural context or missing authoritative bindings', () => {
    const base = book(['old'], [fn({ old: '=old' })]);
    const current = structuredClone(base);
    current.documents.old.content.columns = ['other'];
    const server = book(['old', 'new'], [fn({ old: '=old', new: '=new' })]);
    expect(settle(base, current, server)).toEqual({ ok: false, reason: 'recovery-required' });
    server.functions = [fn({ old: '=old' })];
    expect(settle(base, base, server)).toEqual({ ok: false, reason: 'recovery-required' });
  });
  it('retains locally added sheets and their existing bindings', () => {
    const base = book(['old'], [fn({ old: '=old' })]);
    const current = book(['old', 'local'], [fn({ old: '=old', local: '=local' })]);
    const server = book(['old', 'new'], [fn({ old: '=old', new: '=new' })]);
    const result = settle(base, current, server);
    expect(result.ok && result.workbook.manifest.sheetIds).toEqual(['old', 'local', 'new']);
    expect(result.ok && result.workbook.functions?.[0].bodyBindings).toEqual({ old: '=old', local: '=local', new: '=new' });
  });
  it('rejects incompatible declarations, invalid merged identities and bad stored bindings', () => {
    const base = book(['old'], [fn({ old: '=old' })]);
    const current = book(['old'], [fn({ old: '=old' }, '=LOCAL(')]);
    const server = book(['old', 'new'], [fn({ old: '=old', new: '=new' }, '=SERVER(')]);
    expect(settle(base, current, server)).toEqual({ ok: false, reason: 'conflict' });
    server.functions = [fn({ old: '=old', new: '=new' })];
    server.documents.new.name = 'old';
    expect(settle(base, base, server)).toEqual({ ok: false, reason: 'conflict' });
    server.documents.new.name = 'new';
    server.functions = [{ ...server.functions[0], bodyBindings: { old: '=old' as never, new: 'not a formula' as never } }];
    expect(settle(base, base, server)).toEqual({ ok: false, reason: 'recovery-required' });
  });
  it('rejects known created identities and stale remote document revisions', () => {
    const base = book(['old']), server = book(['old', 'new']);
    expect(settle(base, base, server, 'new', { new: 1 })).toEqual({ ok: false, reason: 'stale' });
    const current = structuredClone(base);
    current.documents.old.revision = 5;
    server.documents.old.name = 'changed';
    expect(settle(base, current, server)).toEqual({ ok: false, reason: 'stale' });
  });

});
