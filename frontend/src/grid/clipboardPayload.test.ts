import { describe, expect, it } from 'vitest';
import { ClipboardPayloadStore, decodeTsv, encodeTsv } from '@grid/clipboardPayload';
import { cellTargetAt } from '@grid/cellInteraction';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { formulaRawForStorage } from '@workbook/formula/reference';

describe('TSV clipboard codec', () => {
  it('round trips blank cells, rows, trailing fields, ragged rows, and scalar values as a rectangular footprint', () => {
    const text = encodeTsv([['left', '', ''], [], ['bottom']]);
    expect(text).toBe('left\t\t\n\t\t\nbottom\t\t');
    expect(decodeTsv(text)).toEqual({ ok: true, value: { rowCount: 3, columnCount: 3, rows: [['left', '', ''], ['', '', ''], ['bottom', '', '']] } });
    expect(decodeTsv('')).toEqual({ ok: true, value: { rowCount: 1, columnCount: 1, rows: [['']] } });
    expect(encodeTsv('scalar')).toBe('scalar');
    expect(decodeTsv('one\ttwo\nthree')).toEqual({ ok: true, value: { rowCount: 2, columnCount: 2, rows: [['one', 'two'], ['three', '']] } });
  });

  it('handles LF and CRLF records plus quoted tabs, quotes, and embedded newlines', () => {
    const text = encodeTsv([['a\tb', 'a"b'], ['one\ntwo', '']]);
    expect(text).toBe('"a\tb"\t"a""b"\n"one\ntwo"\t');
    expect(decodeTsv('"a\tb"\t"a""b"\r\n"one\ntwo"\t')).toEqual({ ok: true, value: { rowCount: 2, columnCount: 2, rows: [['a\tb', 'a"b'], ['one\ntwo', '']] } });
  });

  it('does not manufacture a blank row for a terminal LF or CRLF record delimiter', () => {
    const expected = { ok: true, value: { rowCount: 1, columnCount: 2, rows: [['A', 'B']] } };
    expect(decodeTsv('A\tB\n')).toEqual(expected);
    expect(decodeTsv('A\tB\r\n')).toEqual(expected);
  });

  it('makes malformed quoting an explicit failure', () => {
    expect(decodeTsv('"unterminated')).toEqual({ ok: false, reason: 'malformed-tsv' });
    expect(decodeTsv('"quoted"tail')).toEqual({ ok: false, reason: 'malformed-tsv' });
    expect(decodeTsv('bare\rreturn')).toEqual({ ok: false, reason: 'malformed-tsv' });
    expect(decodeTsv('prefix"quoted"')).toEqual({ ok: false, reason: 'malformed-tsv' });
  });
});

describe('clipboard payload provenance', () => {
  it('exports raw content with formulas projected for people, while preserving canonical source raws privately', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 2, cells: { A1: 'literal', B1: '' } });
    const workbook = workbookWithSheets([source]);
    const canonical = formulaRawForStorage('=A1', workbook, source.id);
    const formulaSheet = { ...source, content: { ...source.content, cells: { ...source.content.cells, [source.content.rows[1]! + '\u0000' + source.content.columns[0]!]: canonical } } };
    const model = workbookWithSheets([formulaSheet]);
    const a1 = cellTargetAt(formulaSheet, 'A1')!;
    const a2 = cellTargetAt(formulaSheet, 'A2')!;
    const store = new ClipboardPayloadStore();
    const copied = store.copy(model, { mode: 'cells', anchor: a1, extent: a2 });
    expect(copied).toMatchObject({ ok: true, value: { text: 'literal\n=A1', dimensions: { rowCount: 2, columnCount: 1 } } });
    if (!copied.ok) throw new Error('copy failed');
    const parsed = store.parse(model, copied.value);
    expect(parsed).toMatchObject({ ok: true, value: { kind: 'internal', source: { cells: [[{ raw: 'literal' }], [{ raw: canonical }]] } } });
  });

  it('uses stable range identities for finite row and column selections', () => {
    const sheet = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 2, cells: { A1: 'a', B1: 'b', A2: 'c', B2: 'd' } });
    const workbook = workbookWithSheets([sheet]);
    const store = new ClipboardPayloadStore();
    const copied = store.copy(workbook, { mode: 'rows', anchor: cellTargetAt(sheet, 'B1')!, extent: cellTargetAt(sheet, 'A2')! });
    expect(copied).toMatchObject({ ok: true, value: { text: 'a\tb\nc\td' } });
    const columns = store.copy(workbook, { mode: 'columns', anchor: cellTargetAt(sheet, 'A2')!, extent: cellTargetAt(sheet, 'B1')! });
    expect(columns).toMatchObject({ ok: true, value: { text: 'a\tb\nc\td' } });
  });

  it('rejects unknown and non-finite selections while treating an untracked marker as external text', () => {
    const sheet = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 2 });
    const other = sheetDocument({ id: 'other', name: 'Other' });
    const workbook = workbookWithSheets([sheet, other]);
    const store = new ClipboardPayloadStore();
    const a1 = cellTargetAt(sheet, 'A1')!;

    expect(store.copy(workbook, { mode: 'cells', anchor: { ...a1, sheetId: 'missing' }, extent: { ...a1, sheetId: 'missing' } }))
      .toEqual({ ok: false, reason: 'unknown-sheet' });
    expect(store.copy(workbook, { mode: 'cells', anchor: a1, extent: { ...cellTargetAt(other, 'A1')!, sheetId: other.id } }))
      .toEqual({ ok: false, reason: 'invalid-selection' });
    expect(store.copy(workbook, { mode: 'cells', anchor: a1, extent: { sheetId: sheet.id, cell: { rowId: 'missing', columnId: 'missing' } } }))
      .toEqual({ ok: false, reason: 'invalid-selection' });
    expect(store.parse(workbook, { text: 'outside', marker: 'sheetspace:not-owned' }))
      .toMatchObject({ ok: true, value: { kind: 'external', grid: { rows: [['outside']] } } });
    const copied = store.copy(workbook, { mode: 'cells', anchor: a1, extent: a1 });
    if (!copied.ok) throw new Error('copy failed');
    expect(store.parse(workbookWithSheets([other]), copied.value)).toMatchObject({ ok: true, value: { kind: 'external' } });
    const withoutColumn = { ...sheet, content: { ...sheet.content, columns: sheet.content.columns.slice(1) } };
    expect(store.parse(workbookWithSheets([withoutColumn, other]), copied.value)).toMatchObject({ ok: true, value: { kind: 'external' } });
  });

  it('only trusts the latest exact marker, text, dimensions, and surviving source identities', () => {
    const sheet = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 2, cells: { A1: 'one', B1: 'two' } });
    const workbook = workbookWithSheets([sheet]);
    const store = new ClipboardPayloadStore();
    const copied = store.copy(workbook, { mode: 'cells', anchor: cellTargetAt(sheet, 'A1')!, extent: cellTargetAt(sheet, 'B1')! });
    if (!copied.ok) throw new Error('copy failed');
    expect(store.parse(workbook, copied.value)).toMatchObject({ ok: true, value: { kind: 'internal' } });
    expect(store.parse(workbook, { text: copied.value.text })).toMatchObject({ ok: true, value: { kind: 'external' } });
    expect(store.parse(workbook, { text: 'one\tchanged', marker: copied.value.marker })).toMatchObject({ ok: true, value: { kind: 'external' } });
    expect(store.parse(workbook, { text: 'one', marker: copied.value.marker })).toMatchObject({ ok: true, value: { kind: 'external' } });
    const replacement = store.copy(workbook, { mode: 'cells', anchor: cellTargetAt(sheet, 'A1')!, extent: cellTargetAt(sheet, 'A1')! });
    expect(store.parse(workbook, copied.value)).toMatchObject({ ok: true, value: { kind: 'external' } });
    if (!replacement.ok) throw new Error('replacement copy failed');
    const removedRow = { ...sheet, content: { ...sheet.content, rows: sheet.content.rows.slice(1) } };
    expect(store.parse(workbookWithSheets([removedRow]), replacement.value)).toMatchObject({ ok: true, value: { kind: 'external' } });
  });
});
