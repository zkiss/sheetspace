import type { FormulaExpression, FormulaReference } from '@workbook/formula/syntax';
import { collectFormulaReferences } from '@workbook/formula/syntax';
import { analyzeFunctionBody } from '@workbook/formula/functionBodyAnalysis';
import type { Workbook } from '@workbook/core/model';

export function functionReferences(expression: FormulaExpression, workbook: Workbook | undefined, sheetId: string): FormulaReference[] {
  const references = collectFormulaReferences(expression);
  const visited = new Set<string>();
  const visit = (node: FormulaExpression) => {
    if (node.kind === 'group') visit(node.expression);
    else if (node.kind === 'unary') visit(node.operand);
    else if (node.kind === 'binary') { visit(node.left); visit(node.right); }
    else if (node.kind === 'function') {
      node.arguments.forEach(visit);
      const name = node.functionName.toUpperCase();
      const definition = workbook?.functions?.find((item) => item.name.toUpperCase() === name);
      if (!definition || !workbook || visited.has(name)) return;
      visited.add(name);
      const body = analyzeFunctionBody(definition, workbook, sheetId).bound?.result;
      if (body?.kind === 'formula') {
        references.push(...collectFormulaReferences(body.expression));
        visit(body.expression);
      }
    }
  };
  visit(expression);
  return references;
}
