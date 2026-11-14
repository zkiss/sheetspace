import { builtInFormulaFunctions } from './formulaBuiltins';
import type { CustomFunction, Workbook } from '@workbook/core/model';
import { prepareFunctionBody, prepareFunctionBodyEdit, planFunctionBodyEdit } from '@workbook/formula/formulaPreparation';
import type { StoredFormulaContent } from '@workbook/core/storedFormulaContent';

export type CustomFunctionDeclarationError =
  | 'invalid-name'
  | 'duplicate-name'
  | 'built-in-name'
  | 'invalid-parameter-name'
  | 'duplicate-parameter-name'
  | 'invalid-parameter-type';

const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
const parameterTypes = new Set(['int', 'float', 'string', 'boolean']);

export function reconcileFunctionBodyBinding(
  workbook: Workbook, sheetId: string, previous: CustomFunction, binding: StoredFormulaContent | undefined, next: CustomFunction, excludedQualifiedSheetId?: string,
): StoredFormulaContent | undefined {
  if (!next.body.startsWith('=')) return undefined;
  const parameters = next.parameters.map((parameter) => parameter.name);
  const previousParameters = previous.parameters.map((parameter) => parameter.name);
  if (!binding || JSON.stringify(parameters) !== JSON.stringify(previousParameters)) return prepareFunctionBody(next.body, workbook, sheetId, parameters, excludedQualifiedSheetId);
  if (next.body === previous.body) return binding;
  return prepareFunctionBodyEdit(next.body, previous.body, binding, workbook, sheetId, parameters, previousParameters, excludedQualifiedSheetId);
}

/** Validates the declaration independently of its editable formula body. */
export function validateCustomFunction(
  definition: CustomFunction,
  existing: readonly CustomFunction[],
  previousName?: string,
): CustomFunctionDeclarationError | undefined {
  const name = definition.name.toUpperCase();
  if (!identifier.test(definition.name) || name === 'TRUE' || name === 'FALSE') return 'invalid-name';
  if (builtInFormulaFunctions.has(name)) return 'built-in-name';
  if (existing.some((item) => item.name.toUpperCase() === name && item.name.toUpperCase() !== previousName?.toUpperCase())) return 'duplicate-name';
  const names = new Set<string>();
  for (const parameter of definition.parameters) {
    const normalized = parameter.name.toUpperCase();
    if (!identifier.test(parameter.name) || normalized === 'TRUE' || normalized === 'FALSE') return 'invalid-parameter-name';
    if (names.has(normalized)) return 'duplicate-parameter-name';
    if (!parameterTypes.has(parameter.type)) return 'invalid-parameter-type';
    names.add(normalized);
  }
  return undefined;
}

export function setCustomFunction(
  workbook: Workbook,
  definition: CustomFunction,
  previousName?: string,
): { ok: true; workbook: Workbook } | { ok: false; error: CustomFunctionDeclarationError } {
  const functions = workbook.functions ?? [];
  const error = validateCustomFunction(definition, functions, previousName);
  if (error) return { ok: false, error };
  const previous = functions.find((item) => item.name.toUpperCase() === previousName?.toUpperCase());
  const parameters = definition.parameters.map((parameter) => parameter.name);
  const sameBody = previous?.body === definition.body && JSON.stringify(previous.parameters.map((parameter) => parameter.name)) === JSON.stringify(parameters);
  const plan = previous && !sameBody && definition.body.startsWith('=') ? planFunctionBodyEdit(definition.body, previous.body, parameters, previous.parameters.map((parameter) => parameter.name)) : undefined;
  const bodyBindings = Object.fromEntries((definition.body.startsWith('=') ? Object.keys(workbook.documents) : []).map((sheetId) => [sheetId,
    sameBody && previous.bodyBindings?.[sheetId] || (previous?.bodyBindings?.[sheetId]
      ? prepareFunctionBodyEdit(definition.body, previous.body, previous.bodyBindings[sheetId], workbook, sheetId, parameters, previous.parameters.map((parameter) => parameter.name), undefined, plan)
      : prepareFunctionBody(definition.body, workbook, sheetId, parameters)),
  ]));
  const retained = functions.filter((item) => item.name.toUpperCase() !== previousName?.toUpperCase());
  return { ok: true, workbook: { ...workbook, functions: [...retained, { ...definition, bodyBindings }] } };
}

export function deleteCustomFunction(workbook: Workbook, name: string): Workbook {
  return { ...workbook, functions: (workbook.functions ?? []).filter((item) => item.name.toUpperCase() !== name.toUpperCase()) };
}

export function bindCustomFunctionsForSheet(workbook: Workbook, sheetId: string): Workbook {
  if (!workbook.documents[sheetId] || !workbook.functions?.length) return workbook;
  return {
    ...workbook,
    functions: workbook.functions.map((definition) => !definition.body.startsWith('=') || definition.bodyBindings?.[sheetId] !== undefined ? definition : ({
      ...definition,
      bodyBindings: {
        ...definition.bodyBindings,
        [sheetId]: prepareFunctionBody(definition.body, workbook, sheetId, definition.parameters.map((parameter) => parameter.name)),
      },
    })),
  };
}

export function removeCustomFunctionSheetBindings(workbook: Workbook, sheetIds: readonly string[]): Workbook {
  if (!workbook.functions?.length) return workbook;
  return { ...workbook, functions: workbook.functions.map((definition) => {
    if (!definition.bodyBindings) return definition;
    const bodyBindings = { ...definition.bodyBindings };
    for (const sheetId of sheetIds) delete bodyBindings[sheetId];
    return { ...definition, bodyBindings };
  }) };
}
