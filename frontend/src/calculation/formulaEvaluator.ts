import {
  expandRange,
  isAddressWithinBounds,
  type CellKey,
} from '@workbook/core/address';
import { builtInFormulaFunctions } from '@calculation/formulaBuiltins';
import {
  applyComparisonOperator,
  compareFormulaScalars,
  isComparisonOperator,
} from '@calculation/formulaComparison';
import {
  evaluateFunctionCall,
  type FormulaReferenceArgumentResult,
  type FormulaFunctionRegistry,
} from '@calculation/formulaFunctions';
import {
  parseFormula,
  type BinaryFormula,
  type FormulaExpression,
  type FormulaReference,
  type UnaryFormula,
} from '@workbook/formula/syntax';
import {
  classifyCellValue,
  diagnosticAtCell,
  diagnosticError,
  formulaDiagnostic,
  displayFormulaValue,
  formulaErrorValue,
  formulaScalarValue,
  matchesModelColumnType,
  type FormulaEvaluationSnapshot,
  type FormulaScalarValue,
  type FormulaValue,
} from '@calculation/formulaValue';
import type {
  CalculationProjection,
  CalculationSheet,
} from '@workbook/read/calculationProjection';
import { calculationCellKey } from '@workbook/read/calculationProjection';
import { cellIdentityFromKey } from '@workbook/core/cellIdentity';
import { cellKey } from '@workbook/core/address';
import { sheetCellNodeId } from './nodeIdentity';
import type { Workbook } from '@workbook/core/model';
import { analyzeStoredFormula } from '@workbook/formula/storedFormulaAnalysis';

export type FormulaEvaluationObserver = (sheetId: string, cellKey: CellKey) => void;

export function evaluateFormulaCells<T extends CalculationProjection>(
  projection: T,
): FormulaEvaluationSnapshot {
  return new FormulaEvaluator(projection).evaluate();
}

/** Evaluate a projection whose formula cells contain trusted stored formulas. */
export function evaluateStoredFormulaCells(projection: CalculationProjection, workbook: Workbook): FormulaEvaluationSnapshot {
  return new FormulaEvaluator(projection, new Map(), undefined, builtInFormulaFunctions,
    (content, sheetId) => analyzeStoredFormula(content, workbook, sheetId).result).evaluate();
}

export class FormulaEvaluator {
  private readonly results: Map<string, FormulaScalarValue>;
  private readonly visiting = new Set<string>();
  private readonly stack: { nodeId: string; sheet: CalculationSheet; key: CellKey }[] = [];

  constructor(
    private readonly workbook: CalculationProjection,
    initialResults: ReadonlyMap<string, FormulaScalarValue> = new Map(),
    private readonly onEvaluate?: FormulaEvaluationObserver,
    private readonly functions: FormulaFunctionRegistry = builtInFormulaFunctions,
    private readonly parse: (content: string, sheetId: string) => ReturnType<typeof parseFormula> = parseFormula,
  ) {
    this.results = new Map(initialResults);
  }

  formulaResults(): Map<string, FormulaScalarValue> {
    return new Map(this.results);
  }

  /** Evaluates a detached expression without adding a reference target to the workbook. */
  evaluateExpressionContent(content: string, sheetId: string): FormulaScalarValue {
    const sheet = this.workbook.sheets.find((candidate) => candidate.id === sheetId);
    if (!sheet) return diagnosticError('#REF!', 'Sheet does not exist.');
    const parsed = this.parse(content, sheetId);
    return parsed.kind === 'formula'
      ? formulaScalarValue(this.evaluateExpression(parsed.expression, sheet))
      : diagnosticError(parsed.kind === 'error' ? parsed.error : '#PARSE!', 'Could not parse formula.');
  }

  evaluate(): FormulaEvaluationSnapshot {
    for (const sheet of this.workbook.sheets) {
      for (const key of Object.keys(sheet.cells).sort()) {
        if (sheet.cells[key].startsWith('=')) {
          this.evaluateFormulaCell(sheet, key);
        } else {
          const value = this.evaluateLiteralCell(sheet, key);
          if (value.kind === 'error') this.results.set(sheetCellNodeId(sheet.id, key), value);
        }
      }
    }

    const snapshot: FormulaEvaluationSnapshot = {};
    for (const sheet of this.workbook.sheets) {
      const sheetResults: Record<CellKey, ReturnType<typeof displayFormulaValue>> = {};
      for (const key of Object.keys(sheet.cells).sort()) {
        const result = this.results.get(sheetCellNodeId(sheet.id, key));
        const identity = cellIdentityFromKey(key);
        const rowIndex = identity ? sheet.rows.indexOf(identity.rowId) : -1;
        const columnIndex = identity ? sheet.columns.indexOf(identity.columnId) : -1;
        if (result && rowIndex >= 0 && columnIndex >= 0) {
          sheetResults[cellKey({ rowIndex, columnIndex })] = displayFormulaValue(result);
        }
      }
      snapshot[sheet.id] = sheetResults;
    }
    return snapshot;
  }

  private evaluateFormulaCell(sheet: CalculationSheet, key: CellKey): FormulaScalarValue {
    const nodeId = sheetCellNodeId(sheet.id, key);
    const cached = this.results.get(nodeId);
    if (cached) {
      return cached;
    }

    if (this.visiting.has(nodeId)) {
      const cycleStart = this.stack.findIndex((entry) => entry.nodeId === nodeId);
      for (const entry of this.stack.slice(cycleStart)) {
        this.results.set(entry.nodeId, this.atCell(entry.sheet, entry.key, diagnosticError('#CYCLE!', 'Cycle detected.')));
      }
      return diagnosticError('#CYCLE!', 'Cycle detected.');
    }

    const cell = sheet.cells[key];
    if (!cell?.startsWith('=')) {
      return this.evaluateLiteralCell(sheet, key);
    }

    const identity = cellIdentityFromKey(key);
    const rowIndex = identity ? sheet.rows.indexOf(identity.rowId) : -1;
    const columnIndex = identity ? sheet.columns.indexOf(identity.columnId) : -1;
    this.onEvaluate?.(sheet.id, rowIndex >= 0 && columnIndex >= 0 ? cellKey({ rowIndex, columnIndex }) : key);
    this.visiting.add(nodeId);
    this.stack.push({ nodeId, sheet, key });

    const parsed = this.parse(cell, sheet.id);
    let result: FormulaScalarValue;
    if (parsed.kind === 'error') {
      result = diagnosticError(parsed.error, `Could not parse formula (${parsed.error}).`);
    } else if (parsed.kind === 'formula') {
      result = formulaScalarValue(this.evaluateExpression(parsed.expression, sheet));
    } else {
      result = formulaErrorValue('#PARSE!');
    }

    this.stack.pop();
    this.visiting.delete(nodeId);

    const cycleResult = this.results.get(nodeId);
    if (cycleResult?.kind === 'error' && cycleResult.error === '#CYCLE!') {
      return cycleResult;
    }

    const checked = this.atCell(sheet, key, this.checkColumnType(sheet, key, result));
    this.results.set(nodeId, checked);
    return checked;
  }

  private evaluateExpression(expression: FormulaExpression, currentSheet: CalculationSheet): FormulaValue {
    if (expression.kind === 'invalid-reference') return diagnosticError('#REF!', 'Invalid reference.');
    if (expression.kind === 'number') {
      return Number.isFinite(expression.value)
        ? { kind: 'number', value: expression.value }
        : formulaErrorValue('#VALUE!');
    }
    if (expression.kind === 'text') {
      return { kind: 'text', value: expression.value };
    }
    if (expression.kind === 'boolean') {
      return { kind: 'boolean', value: expression.value };
    }
    if (expression.kind === 'group') {
      return this.evaluateExpression(expression.expression, currentSheet);
    }
    if (expression.kind === 'unary') {
      return this.evaluateUnary(expression, currentSheet);
    }
    if (expression.kind === 'binary') {
      return this.evaluateBinary(expression, currentSheet);
    }
    if (expression.kind === 'function') {
      return evaluateFunctionCall(
        expression,
        {
          evaluateExpression: (argument) => this.evaluateExpression(argument, currentSheet),
          evaluateReferenceArgument: (argument) =>
            this.evaluateFunctionReferenceArgument(argument, currentSheet),
        },
        this.functions,
      );
    }
    return this.evaluateReference(expression, currentSheet);
  }

  private evaluateUnary(expression: UnaryFormula, currentSheet: CalculationSheet): FormulaScalarValue {
    const operand = formulaScalarValue(this.evaluateExpression(expression.operand, currentSheet));
    if (operand.kind === 'error') {
      return operand;
    }
    if (operand.kind !== 'number') {
      return diagnosticError('#VALUE!', `Expected a number, got ${describeValue(operand)}.`);
    }

    const value = expression.operator === '-' ? -operand.value : operand.value;
    return Number.isFinite(value)
      ? { kind: 'number', value }
      : formulaErrorValue('#VALUE!');
  }

  private evaluateBinary(expression: BinaryFormula, currentSheet: CalculationSheet): FormulaScalarValue {
    const left = formulaScalarValue(this.evaluateExpression(expression.left, currentSheet));
    const right = formulaScalarValue(this.evaluateExpression(expression.right, currentSheet));
    if (left.kind === 'error' && right.kind === 'error') {
      const causes = [formulaDiagnostic(left), formulaDiagnostic(right)].filter((cause) => cause !== undefined);
      return diagnosticError(left.error, `Multiple operands failed (${left.error}, ${right.error}).`, causes);
    }
    if (left.kind === 'error') return left;
    if (right.kind === 'error') return right;

    if (isComparisonOperator(expression.operator)) {
      if (left.kind !== right.kind) {
        return diagnosticError('#VALUE!', `Cannot compare ${describeValue(left)} with ${describeValue(right)}: expected matching types.`);
      }
      const comparison = compareFormulaScalars(left, right);
      return comparison === undefined
        ? formulaErrorValue('#VALUE!')
        : { kind: 'boolean', value: applyComparisonOperator(comparison, expression.operator) };
    }

    if (left.kind !== 'number' || right.kind !== 'number') {
      return diagnosticError('#VALUE!', `Cannot apply ${expression.operator} to ${describeValue(left)} and ${describeValue(right)}: expected numbers.`);
    }
    if (expression.operator === '/' && right.value === 0) {
      return diagnosticError('#DIV/0!', `Cannot divide ${left.value} by zero.`);
    }

    const value =
      expression.operator === '+'
        ? left.value + right.value
        : expression.operator === '-'
          ? left.value - right.value
          : expression.operator === '*'
            ? left.value * right.value
            : left.value / right.value;
    return Number.isFinite(value)
      ? { kind: 'number', value }
      : diagnosticError('#VALUE!', `Nonfinite result applying ${expression.operator} to ${left.value} and ${right.value}.`);
  }

  private evaluateReference(reference: FormulaReference, currentSheet: CalculationSheet): FormulaValue {
    if (reference.kind === 'named') return diagnosticError('#REF!', 'Unresolved name.');
    const sheet = resolveFormulaReferenceSheet(reference, this.workbook, currentSheet);
    if (!sheet) {
      return diagnosticError('#REF!', 'Referenced sheet does not exist.');
    }

    if (reference.kind === 'canonical') {
      if (!namedReferenceIsValid(reference, sheet)) return formulaErrorValue('#REF!');
      const key = calculationCellKey(sheet, reference.coordinate);
      if (!key) return formulaErrorValue('#REF!');
      if (!reference.range) return this.evaluateReferencedCell(sheet, key);
      const addresses = canonicalRangeAddresses(sheet, reference.range);
      if (!addresses) return formulaErrorValue('#REF!');
      return { kind: 'range', values: this.evaluateRangeCells(sheet, addresses), rowCount: addresses.length / rangeColumnCount(sheet, reference.range), columnCount: rangeColumnCount(sheet, reference.range) };
    }
    if (reference.kind === 'cell') {
      if (!isAddressWithinBounds(reference.address, { rowCount: sheet.rows.length, columnCount: sheet.columns.length })) return formulaErrorValue('#REF!');
      const key = calculationCellKey(sheet, { rowId: sheet.rows[reference.address.rowIndex]!, columnId: sheet.columns[reference.address.columnIndex]! });
      return key ? this.evaluateReferencedCell(sheet, key) : formulaErrorValue('#REF!');
    }
    const materialized = reference.open ? { start: reference.range.start, end: { ...reference.range.end, rowIndex: sheet.rows.length - 1 } } : reference.range;
    const range = expandRange(materialized, { rowCount: sheet.rows.length, columnCount: sheet.columns.length });
    if (!range.ok) return formulaErrorValue('#REF!');
    const keys = range.value.map((address) => calculationCellKey(sheet, { rowId: sheet.rows[address.rowIndex]!, columnId: sheet.columns[address.columnIndex]! })!);
    return { kind: 'range', values: this.evaluateRangeCells(sheet, keys), rowCount: materialized.end.rowIndex - materialized.start.rowIndex + 1, columnCount: reference.range.end.columnIndex - reference.range.start.columnIndex + 1 };
  }

  private evaluateFunctionReferenceArgument(
    expression: FormulaExpression,
    currentSheet: CalculationSheet,
  ): FormulaReferenceArgumentResult {
    if (expression.kind === 'invalid-reference') return { ok: false, error: '#REF!' };
    if (expression.kind === 'group') {
      return this.evaluateFunctionReferenceArgument(expression.expression, currentSheet);
    }
    if (expression.kind !== 'cell' && expression.kind !== 'range' && expression.kind !== 'canonical') {
      return { ok: false, error: '#VALUE!' };
    }
    const sheet = resolveFormulaReferenceSheet(expression, this.workbook, currentSheet);
    if (!sheet) return { ok: false, error: '#REF!' };
    if (expression.kind === 'cell') {
      const key = isAddressWithinBounds(expression.address, { rowCount: sheet.rows.length, columnCount: sheet.columns.length }) ? calculationCellKey(sheet, { rowId: sheet.rows[expression.address.rowIndex]!, columnId: sheet.columns[expression.address.columnIndex]! }) : undefined;
      return key ? { ok: true, value: { values: this.evaluateRangeCells(sheet, [key]), rowCount: 1, columnCount: 1 } } : { ok: false, error: '#REF!' };
    }
    if (expression.kind === 'range') {
      const materialized = expression.open ? { start: expression.range.start, end: { ...expression.range.end, rowIndex: sheet.rows.length - 1 } } : expression.range;
      const range = expandRange(materialized, { rowCount: sheet.rows.length, columnCount: sheet.columns.length });
      if (!range.ok) return { ok: false, error: '#REF!' };
      const keys = range.value.map((address) => calculationCellKey(sheet, { rowId: sheet.rows[address.rowIndex]!, columnId: sheet.columns[address.columnIndex]! })!);
      return { ok: true, value: { values: this.evaluateRangeCells(sheet, keys), rowCount: materialized.end.rowIndex - materialized.start.rowIndex + 1, columnCount: expression.range.end.columnIndex - expression.range.start.columnIndex + 1 } };
    }
    if (!namedReferenceIsValid(expression, sheet)) return { ok: false, error: '#REF!' };
    const key = calculationCellKey(sheet, expression.coordinate);
    if (!key) return { ok: false, error: '#REF!' };
    if (!expression.range) {
      return {
        ok: true,
        value: {
          values: this.evaluateRangeCells(sheet, [key]),
          rowCount: 1,
          columnCount: 1,
        },
      };
    }

    const range = canonicalRangeAddresses(sheet, expression.range);
    if (!range) return { ok: false, error: '#REF!' };
    return {
      ok: true,
      value: {
        values: this.evaluateRangeCells(sheet, range),
        rowCount: range.length / rangeColumnCount(sheet, expression.range),
        columnCount: rangeColumnCount(sheet, expression.range),
      },
    };
  }

  private *evaluateRangeCells(
    sheet: CalculationSheet,
    addresses: readonly string[],
  ): IterableIterator<FormulaScalarValue> {
    for (const address of addresses) {
      yield this.evaluateReferencedCell(sheet, address);
    }
  }

  private evaluateReferencedCell(sheet: CalculationSheet, key: CellKey): FormulaScalarValue {
    const cell = sheet.cells[key];
    if (cell === undefined) {
      return { kind: 'blank' };
    }
    return cell.startsWith('=')
      ? this.evaluateFormulaCell(sheet, key)
      : this.evaluateLiteralCell(sheet, key);
  }

  private evaluateLiteralCell(sheet: CalculationSheet, key: CellKey): FormulaScalarValue {
    return this.atCell(sheet, key, this.checkColumnType(sheet, key, classifyCellValue(sheet.cells[key] ?? '')));
  }

  private checkColumnType(sheet: CalculationSheet, key: CellKey, value: FormulaScalarValue): FormulaScalarValue {
    const identity = cellIdentityFromKey(key);
    const type = identity && sheet.columnTypes?.[identity.columnId];
    return type && !matchesModelColumnType(value, type) ? diagnosticError('#VALUE!', `Expected ${type}, got ${describeValue(value)}.`) : value;
  }

  private atCell(sheet: CalculationSheet, key: CellKey, value: FormulaScalarValue): FormulaScalarValue {
    const identity = cellIdentityFromKey(key);
    return diagnosticAtCell(value, identity ? { sheetId: sheet.id, ...identity } : undefined);
  }
}

function describeValue(value: FormulaScalarValue): string {
  if (value.kind === 'blank') return 'blank';
  if (value.kind === 'error') return value.error;
  return `${value.kind} ${JSON.stringify(value.value)}`;
}

function canonicalRangeAddresses(sheet: CalculationSheet, range: NonNullable<Extract<FormulaReference, { kind: 'canonical' }>['range']>): string[] | undefined {
  const startRow = sheet.rows.indexOf(range.start.rowId), endRow = range.open ? sheet.rows.length - 1 : sheet.rows.indexOf(range.end.rowId);
  const startColumn = sheet.columns.indexOf(range.start.columnId), endColumn = sheet.columns.indexOf(range.end.columnId);
  if (Math.min(startRow, endRow, startColumn, endColumn) < 0) return undefined;
  const addresses: string[] = [];
  for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row += 1) for (let column = Math.min(startColumn, endColumn); column <= Math.max(startColumn, endColumn); column += 1) addresses.push(calculationCellKey(sheet, { rowId: sheet.rows[row]!, columnId: sheet.columns[column]! })!);
  return addresses;
}

function rangeColumnCount(sheet: CalculationSheet, range: NonNullable<Extract<FormulaReference, { kind: 'canonical' }>['range']>): number {
  return Math.abs(sheet.columns.indexOf(range.end.columnId) - sheet.columns.indexOf(range.start.columnId)) + 1;
}

function resolveFormulaReferenceSheet(
  reference: Pick<FormulaReference, 'sheetId'>,
  workbook: CalculationProjection,
  defaultSheet: CalculationSheet,
): CalculationSheet | undefined {
  if (reference.sheetId) {
    return workbook.sheets.find((candidate) => candidate.id === reference.sheetId);
  }
  return defaultSheet;
}

function namedReferenceIsValid(reference: Extract<FormulaReference, { kind: 'canonical' }>, sheet: CalculationSheet): boolean {
  const validProperty = (propertyId: string | undefined, columnId: string) => !propertyId || Boolean((propertyId === columnId && sheet.ordinaryNamedColumnIds?.has(columnId)) || (sheet.modelColumnBindings?.[propertyId] === columnId && sheet.modelPropertyIds?.has(propertyId)));
  return validProperty(reference.propertyId, reference.coordinate.columnId)
    && validProperty(reference.range?.endPropertyId, reference.range?.end.columnId ?? '');
}
