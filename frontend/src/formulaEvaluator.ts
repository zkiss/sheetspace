import {
  cellKey,
  expandRange,
  isAddressWithinBounds,
  type CellAddress,
  type CellKey,
} from './cellAddress';
import { builtInFormulaFunctions } from './formulaBuiltins';
import {
  evaluateFunctionCall,
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
import type { Sheet, Workbook } from './workbook';

export type FormulaEvaluationObserver = (sheetId: string, cellKey: CellKey) => void;

export function evaluateFormulaCells(workbook: Workbook): FormulaEvaluationSnapshot {
  return new FormulaEvaluator(workbook).evaluate();
}

export function sheetCellNodeId(sheetId: string, key: CellKey): string {
  return `${sheetId}\u0000${key}`;
}

export class FormulaEvaluator {
  private readonly results: Map<string, FormulaScalarValue>;
  private readonly visiting = new Set<string>();
  private readonly stack: { nodeId: string; sheet: Sheet; key: CellKey }[] = [];

  constructor(
    private readonly workbook: Workbook,
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
        if (result) {
          sheetResults[key] = displayFormulaValue(result);
        }
      }
      snapshot[sheet.id] = sheetResults;
    }
    return snapshot;
  }

  private evaluateFormulaCell(sheet: Sheet, key: CellKey): FormulaScalarValue {
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

    this.onEvaluate?.(sheet.id, key);
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

  private evaluateExpression(expression: FormulaExpression, currentSheet: Sheet): FormulaValue {
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
        { evaluateExpression: (argument) => this.evaluateExpression(argument, currentSheet) },
        this.functions,
      );
    }
    return this.evaluateReference(expression, currentSheet);
  }

  private evaluateUnary(expression: UnaryFormula, currentSheet: Sheet): FormulaScalarValue {
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

  private evaluateBinary(expression: BinaryFormula, currentSheet: Sheet): FormulaScalarValue {
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

  private evaluateReference(reference: FormulaReference, currentSheet: Sheet): FormulaValue {
    const sheet = resolveFormulaReferenceSheet(reference, this.workbook, currentSheet);
    if (!sheet) {
      return formulaErrorValue('#REF!');
    }

    if (reference.kind === 'cell') {
      if (!isAddressWithinBounds(reference.address, sheet)) {
        return formulaErrorValue('#REF!');
      }
      return this.evaluateReferencedCell(sheet, cellKey(reference.address));
    }

    const range = expandRange(reference.range, sheet);
    if (!range.ok) {
      return formulaErrorValue('#REF!');
    }
    return {
      kind: 'range',
      values: this.evaluateRangeCells(sheet, range.value),
      rowCount: reference.range.end.rowIndex - reference.range.start.rowIndex + 1,
      columnCount: reference.range.end.columnIndex - reference.range.start.columnIndex + 1,
    };
  }

  private *evaluateRangeCells(
    sheet: Sheet,
    addresses: readonly CellAddress[],
  ): IterableIterator<FormulaScalarValue> {
    for (const address of addresses) {
      yield this.evaluateReferencedCell(sheet, cellKey(address));
    }
  }

  private evaluateReferencedCell(sheet: Sheet, key: CellKey): FormulaScalarValue {
    const cell = sheet.cells[key];
    if (cell === undefined) {
      return { kind: 'blank' };
    }
    return cell.startsWith('=')
      ? this.evaluateFormulaCell(sheet, key)
      : classifyCellValue(cell);
  }

  private evaluateLiteralCell(sheet: Sheet, key: CellKey): FormulaScalarValue {
    return classifyCellValue(sheet.cells[key] ?? '');
  }
}

function resolveFormulaReferenceSheet(
  reference: Pick<FormulaReference, 'sheetId'>,
  workbook: Workbook,
  defaultSheet: Sheet,
): Sheet | undefined {
  if (reference.sheetId) {
    return workbook.sheets.find((candidate) => candidate.id === reference.sheetId);
  }
  return defaultSheet;
}

function isComparisonOperator(
  operator: BinaryFormula['operator'],
): operator is '=' | '<>' | '<' | '<=' | '>' | '>=' {
  return operator === '='
    || operator === '<>'
    || operator === '<'
    || operator === '<='
    || operator === '>'
    || operator === '>=';
}

function compareFormulaScalars(
  left: FormulaScalarValue,
  right: FormulaScalarValue,
): -1 | 0 | 1 | undefined {
  if (left.kind === 'number' && right.kind === 'number') {
    return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  }
  if (left.kind === 'text' && right.kind === 'text') {
    return compareTextByCodePoint(left.value, right.value);
  }
  if (left.kind === 'boolean' && right.kind === 'boolean') {
    return left.value === right.value ? 0 : left.value ? 1 : -1;
  }
  if (left.kind === 'blank' && right.kind === 'blank') {
    return 0;
  }
  return undefined;
}

function compareTextByCodePoint(left: string, right: string): -1 | 0 | 1 {
  const leftCodePoints = [...left].map((value) => value.codePointAt(0) as number);
  const rightCodePoints = [...right].map((value) => value.codePointAt(0) as number);
  const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftCodePoints[index] !== rightCodePoints[index]) {
      return leftCodePoints[index] < rightCodePoints[index] ? -1 : 1;
    }
  }
  return leftCodePoints.length < rightCodePoints.length
    ? -1
    : leftCodePoints.length > rightCodePoints.length
      ? 1
      : 0;
}

function applyComparisonOperator(
  comparison: -1 | 0 | 1,
  operator: '=' | '<>' | '<' | '<=' | '>' | '>=',
): boolean {
  switch (operator) {
    case '=':
      return comparison === 0;
    case '<>':
      return comparison !== 0;
    case '<':
      return comparison < 0;
    case '<=':
      return comparison <= 0;
    case '>':
      return comparison > 0;
    case '>=':
      return comparison >= 0;
  }
}
