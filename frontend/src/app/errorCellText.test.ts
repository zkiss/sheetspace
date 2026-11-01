import { expect, it } from 'vitest';
import { referenceTextTokens } from '@application/core/referenceTextTokens';
import { errorCellText } from './errorCellText';
import { allocateErrorReferenceColors, errorReferenceKey } from './errorReferenceColors';
import type { WorkbookError } from './workbookErrors';

it('renders flat trace causes with navigable spans and shared distinct colours', () => {
  const root = { sheetId: 's', cell: { rowId: 'r', columnId: 'a' }, reference: '@S!A[1]' };
  const cause = { sheetId: 's', cell: { rowId: 'r', columnId: 'b' }, reference: '@S!B[1]' };
  const error: WorkbookError = { ...root, key: 'a', code: '#VALUE!', text: 'Could not calculate', textReference: cause, hasCauses: true, traceMessage: 'Propagated', trace: [
    { key: '0', depth: 0, target: root, message: 'Propagated' },
    { key: '1', depth: 1, target: cause, message: 'Invalid' },
    { key: '2', depth: 3, target: root, message: 'Again' },
  ] };
  const text = errorCellText(error, 2);
  const compact = errorCellText(error, 3);
  const trace = errorCellText(error, 3, true);
  expect(text.raw).toBe('Could not calculate @S!B[1].');
  expect(compact.raw).toBe('@S!A[1]: Propagated …');
  expect(trace.raw).toBe('@S!A[1]: Propagated\n  caused by @S!B[1]: Invalid\n  caused by @S!A[1]: Again');
  for (const reference of trace.references) expect(trace.raw.slice(reference.displaySpan.start, reference.displaySpan.end)).toBe(reference.text);
  const colors = allocateErrorReferenceColors([...text.references, ...trace.references]);
  expect(colors.size).toBe(2);
  expect(colors.get(errorReferenceKey(text.references[0]))).toBe(colors.get(errorReferenceKey(trace.references[1])));
  expect(colors.get(errorReferenceKey(trace.references[0]))).not.toBe(colors.get(errorReferenceKey(trace.references[1])));
  const tokens = referenceTextTokens(trace.raw, trace.references);
  expect(tokens.filter((token) => token.kind === 'reference').map((token) => trace.raw.slice(token.sourceSpan.start, token.sourceSpan.end))).toEqual(['@S!A[1]', '@S!B[1]', '@S!A[1]']);
});

it('renders trace lines without targets as plain diagnostic text', () => {
  const error: WorkbookError = { key: 'e', sheetId: 's', cell: { rowId: 'r', columnId: 'c' }, reference: 'A1', code: '#REF!', text: 'Missing', trace: [
    { key: 'root', depth: 0, message: 'Failure' },
    { key: 'cause', depth: 1, message: 'Missing input' },
  ] };
  expect(errorCellText(error, 3, true)).toEqual({ raw: 'Failure\n  caused by Missing input', references: [] });
});
