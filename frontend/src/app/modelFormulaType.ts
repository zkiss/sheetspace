import type { ModelColumn, ModelColumnType } from '@workbook/core/model';
import { parseFormulaSyntax, type FormulaExpression } from '@workbook/formula/syntax';

export function inferModelFormulaType(raw: string, columns: readonly ModelColumn[], visited = new Set<string>()): ModelColumnType | undefined {
  const parsed = parseFormulaSyntax(raw, { isNamedColumn: (sheet, name) => !sheet && columns.some((column) => column.name === name) });
  if (parsed.result.kind !== 'formula') return undefined;
  function propertyType(column: ModelColumn | undefined): ModelColumnType | undefined {
    if (!column || visited.has(column.id)) return undefined;
    if (column.kind === 'manual') return column.type;
    return inferModelFormulaType(column.formula, columns, new Set([...visited, column.id]));
  }
  function infer(expression: FormulaExpression): ModelColumnType | undefined {
    switch (expression.kind) {
      case 'number': return Number.isInteger(expression.value) ? 'int' : 'float';
      case 'text': return 'string';
      case 'boolean': return 'boolean';
      case 'group': return infer(expression.expression);
      case 'named': return expression.sheetId || expression.end ? undefined : propertyType(columns.find((column) => column.name === expression.endpoint.propertyName));
      case 'cell': return expression.sheetId ? undefined : propertyType(columns[expression.address.columnIndex]);
      case 'range': case 'canonical': return undefined;
      case 'unary': { const type = infer(expression.operand); return type === 'int' || type === 'float' ? type : undefined; }
      case 'binary': {
        if (['=', '<>', '<', '<=', '>', '>='].includes(expression.operator)) return 'boolean';
        const left = infer(expression.left); const right = infer(expression.right);
        if ((left !== 'int' && left !== 'float') || (right !== 'int' && right !== 'float')) return undefined;
        return expression.operator === '/' || left === 'float' || right === 'float' ? 'float' : 'int';
      }
      case 'function': {
        const name = expression.functionName.toUpperCase();
        if (['AND', 'OR', 'NOT'].includes(name)) return 'boolean';
        if (['COUNT', 'COUNTA', 'COUNTIF'].includes(name)) return 'int';
        if (['AVERAGE', 'SQRT'].includes(name)) return 'float';
        if (name === 'IF') {
          const first = expression.arguments[1] && infer(expression.arguments[1]);
          const second = expression.arguments[2] && infer(expression.arguments[2]);
          return first && first === second ? first : first && second && ['int', 'float'].includes(first) && ['int', 'float'].includes(second) ? 'float' : undefined;
        }
        if (['SUM', 'SUMIF', 'MIN', 'MAX', 'ABS'].includes(name)) return 'float';
        return undefined;
      }
    }
  }
  return infer(parsed.result.expression);
}
