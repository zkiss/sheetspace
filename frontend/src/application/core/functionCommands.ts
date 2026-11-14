import { deleteCustomFunction, setCustomFunction, type CustomFunctionDeclarationError } from '@calculation/customFunctions';
import type { CustomFunction, Workbook } from '@workbook/core/model';

export type FunctionDeclaration = Pick<CustomFunction, 'name' | 'parameters' | 'body'>;
export type FunctionCommandResult =
  | { ok: true; value: Workbook }
  | { ok: false; reason: CustomFunctionDeclarationError | 'unknown-function' };

export function setFunction(workbook: Workbook, declaration: FunctionDeclaration, previousName?: string): FunctionCommandResult {
  if (previousName !== undefined && !workbook.functions?.some((item) => item.name.toUpperCase() === previousName.toUpperCase())) {
    return { ok: false, reason: 'unknown-function' };
  }
  const result = setCustomFunction(workbook, declaration, previousName);
  return result.ok ? { ok: true, value: result.workbook } : { ok: false, reason: result.error };
}

export function deleteFunction(workbook: Workbook, name: string): FunctionCommandResult {
  if (!workbook.functions?.some((item) => item.name.toUpperCase() === name.toUpperCase())) {
    return { ok: false, reason: 'unknown-function' };
  }
  return { ok: true, value: deleteCustomFunction(workbook, name) };
}
