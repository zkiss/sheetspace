import {
  expandRange,
  isAddressWithinBounds,
  type CellKey,
} from './cellAddress';
import { builtInFormulaFunctions } from './formulaBuiltins';
import {
  applyComparisonOperator,
  compareFormulaScalars,
  isComparisonOperator,
} from './formulaComparison';
import {
  evaluateFunctionCall,
  type FormulaReferenceArgumentResult,
  type FormulaFunctionRegistry,
} from './formulaFunctions';
import {
  parseFormula,
  type BinaryFormula,
  type FormulaExpression,
  type FormulaReference,
  type UnaryFormula,
} from './formulaSyntax';
import {
  classifyCellValue,
  displayFormulaValue,
  formulaErrorValue,
  formulaScalarValue,
  type FormulaEvaluationSnapshot,
  type FormulaScalarValue,
  type FormulaValue,
} from './formulaValue';
import type {
  CalculationProjection,
  CalculationSheet,
} from './calculationProjection';
import { calculationCellKey } from './calculationProjection';
import { cellIdentityFromKey } from './stableCellIdentity';
import { cellKey } from './cellAddress';

export type FormulaEvaluationObserver = (sheetId: string, cellKey: CellKey) => void;

export function evaluateFormulaCells<T extends CalculationProjection>(
  projection: T,
): FormulaEvaluationSnapshot {
  return new FormulaEvaluator(projection).evaluate();
}

export function sheetCellNodeId(sheetId: string, key: string): string {
  return `${sheetId}\u0000${key}`;
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
  ) {
    this.results = new Map(initialResults);
  }

  formulaResults(): Map<string, FormulaScalarValue> {
    return new Map(this.results);
  }

  evaluate(): FormulaEvaluationSnapshot {
    for (const sheet of this.workbook.sheets) {
      for (const key of Object.keys(sheet.cells).sort()) {
        if (sheet.cells[key].startsWith('=')) {
          this.evaluateFormulaCell(sheet, key);
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
        this.results.set(entry.nodeId, formulaErrorValue('#CYCLE!'));
      }
      return formulaErrorValue('#CYCLE!');
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

    const parsed = parseFormula(cell);
    let result: FormulaScalarValue;
    if (parsed.kind === 'error') {
      result = formulaErrorValue(parsed.error);
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

    this.results.set(nodeId, result);
    return result;
  }

  private evaluateExpression(expression: FormulaExpression, currentSheet: CalculationSheet): FormulaValue {
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
      return formulaErrorValue('#VALUE!');
    }

    const value = expression.operator === '-' ? -operand.value : operand.value;
    return Number.isFinite(value)
      ? { kind: 'number', value }
      : formulaErrorValue('#VALUE!');
  }

  private evaluateBinary(expression: BinaryFormula, currentSheet: CalculationSheet): FormulaScalarValue {
    const left = formulaScalarValue(this.evaluateExpression(expression.left, currentSheet));
    if (left.kind === 'error') {
      return left;
    }

    const right = formulaScalarValue(this.evaluateExpression(expression.right, currentSheet));
    if (right.kind === 'error') {
      return right;
    }

    if (isComparisonOperator(expression.operator)) {
      if (left.kind !== right.kind) {
        return formulaErrorValue('#VALUE!');
      }
      const comparison = compareFormulaScalars(left, right);
      return comparison === undefined
        ? formulaErrorValue('#VALUE!')
        : { kind: 'boolean', value: applyComparisonOperator(comparison, expression.operator) };
    }

    if (left.kind !== 'number' || right.kind !== 'number') {
      return formulaErrorValue('#VALUE!');
    }
    if (expression.operator === '/' && right.value === 0) {
      return formulaErrorValue('#DIV/0!');
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
      : formulaErrorValue('#VALUE!');
  }

  private evaluateReference(reference: FormulaReference, currentSheet: CalculationSheet): FormulaValue {
    const sheet = resolveFormulaReferenceSheet(reference, this.workbook, currentSheet);
    if (!sheet) {
      return formulaErrorValue('#REF!');
    }

    if (reference.kind === 'canonical') {
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
    const range = expandRange(reference.range, { rowCount: sheet.rows.length, columnCount: sheet.columns.length });
    if (!range.ok) return formulaErrorValue('#REF!');
    const keys = range.value.map((address) => calculationCellKey(sheet, { rowId: sheet.rows[address.rowIndex]!, columnId: sheet.columns[address.columnIndex]! })!);
    return { kind: 'range', values: this.evaluateRangeCells(sheet, keys), rowCount: reference.range.end.rowIndex - reference.range.start.rowIndex + 1, columnCount: reference.range.end.columnIndex - reference.range.start.columnIndex + 1 };
  }

  private evaluateFunctionReferenceArgument(
    expression: FormulaExpression,
    currentSheet: CalculationSheet,
  ): FormulaReferenceArgumentResult {
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
      const range = expandRange(expression.range, { rowCount: sheet.rows.length, columnCount: sheet.columns.length });
      if (!range.ok) return { ok: false, error: '#REF!' };
      const keys = range.value.map((address) => calculationCellKey(sheet, { rowId: sheet.rows[address.rowIndex]!, columnId: sheet.columns[address.columnIndex]! })!);
      return { ok: true, value: { values: this.evaluateRangeCells(sheet, keys), rowCount: expression.range.end.rowIndex - expression.range.start.rowIndex + 1, columnCount: expression.range.end.columnIndex - expression.range.start.columnIndex + 1 } };
    }
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
      : classifyCellValue(cell);
  }

  private evaluateLiteralCell(sheet: CalculationSheet, key: CellKey): FormulaScalarValue {
    return classifyCellValue(sheet.cells[key] ?? '');
  }
}

function canonicalRangeAddresses(sheet: CalculationSheet, range: NonNullable<Extract<FormulaReference, { kind: 'canonical' }>['range']>): string[] | undefined {
  const startRow = sheet.rows.indexOf(range.start.rowId), endRow = sheet.rows.indexOf(range.end.rowId);
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
