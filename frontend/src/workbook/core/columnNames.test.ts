import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareUserFormula } from '../formula/formulaPreparation';
import { projectStoredFormula } from '../formula/storedFormulaProjection';
import { renameOrdinaryColumn } from './columnNames';

describe('ordinary column names', () => {
  it('validates names against actual bound columns while preserving identities', () => {
    const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const [ordinary, bound] = sheet.content.columns;
    const book = { ...workbookWithSheets([{ ...sheet, modelId: 'm', modelColumnBindings: { p: bound } }]), dataModels: { m: { id: 'm', name: 'Model', columns: [{ id: 'p', name: 'Cost', kind: 'manual' as const, type: 'float' as const }] } } };
    expect(renameOrdinaryColumn(book, 's', ordinary, '  ')).toEqual({ ok: false, reason: 'empty' });
    expect(renameOrdinaryColumn(book, 's', ordinary, ' Cost ')).toEqual({ ok: false, reason: 'duplicate' });
    expect(renameOrdinaryColumn(book, 's', bound, 'Other')).toEqual({ ok: false, reason: 'model-column' });
    const renamed = renameOrdinaryColumn(book, 's', ordinary, ' cost ');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.documents.s.content).toBe(book.documents.s.content);
    expect(renamed.value.documents.s.columnNames).toEqual({ [ordinary]: 'cost' });
    expect(renameOrdinaryColumn(renamed.value, 's', ordinary, 'cost')).toEqual({ ok: true, value: renamed.value });
  });

  it('projects stable named references after successive renames', () => {
    const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 1, columnCount: 1 });
    const book = workbookWithSheets([sheet]);
    const first = renameOrdinaryColumn(book, 's', sheet.content.columns[0], "Owner's cost");
    if (!first.ok) throw new Error(first.reason);
    const stored = prepareUserFormula("=@'Owner''s cost'[1]+@Sheet!'Owner''s cost'[1]", first.value, 's');
    const second = renameOrdinaryColumn(first.value, 's', sheet.content.columns[0], 'New cost');
    if (!second.ok) throw new Error(second.reason);
    expect(projectStoredFormula(stored, second.value, 's').text).toBe("=@'New cost'[1]+@Sheet!'New cost'[1]");
    expect(stored).toBe(prepareUserFormula("=@'New cost'[1]+@Sheet!'New cost'[1]", second.value, 's'));
  });

  it('keeps cross-sheet references and A1 addresses stable while names change independently', () => {
    const source = sheetDocument({ id: 'source', name: 'Source sheet', rowCount: 1, columnCount: 2 });
    const target = sheetDocument({ id: 'target', name: 'Target', rowCount: 1, columnCount: 1 });
    const book = workbookWithSheets([source, target]);
    const first = renameOrdinaryColumn(book, source.id, source.content.columns[1], "Owner's cost");
    if (!first.ok) throw new Error(first.reason);
    const other = renameOrdinaryColumn(first.value, target.id, target.content.columns[0], "Owner's cost");
    if (!other.ok) throw new Error(other.reason);
    const stored = prepareUserFormula("=@'Source sheet'!'Owner''s cost'[1]+@'Source sheet'!B1", other.value, target.id);
    const renamed = renameOrdinaryColumn(other.value, source.id, source.content.columns[1], 'New cost');
    if (!renamed.ok) throw new Error(renamed.reason);
    expect(projectStoredFormula(stored, renamed.value, target.id).text).toBe("=@'Source sheet'!'New cost'[1]+@'Source sheet'!B1");
    expect(prepareUserFormula("=@'Source sheet'!'New cost'[1]+@'Source sheet'!B1", renamed.value, target.id)).toBe(stored);
    expect(renamed.value.documents.target.columnNames).toEqual({ [target.content.columns[0]]: "Owner's cost" });
  });
});
