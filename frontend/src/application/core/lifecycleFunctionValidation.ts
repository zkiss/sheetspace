import type { Workbook } from '@workbook/core/model';
import { validateCustomFunction } from '@calculation/customFunctions';
import { requireStoredFormula } from '@workbook/formula/storedFormula';

export function validLifecycleFunctions(functions: Workbook['functions'], sheetIds?: readonly string[]): boolean {
  if (!Array.isArray(functions)) return false;
  if (!functions.every((fn) => fn && typeof fn === 'object' && !Array.isArray(fn) && typeof fn.name === 'string' && typeof fn.body === 'string'
    && Array.isArray(fn.parameters) && fn.parameters.every((parameter: { name: string; type: string }) => parameter && typeof parameter === 'object' && !Array.isArray(parameter) && typeof parameter.name === 'string'
      && ['int', 'float', 'string', 'boolean'].includes(parameter.type))
    && (fn.identity === undefined || typeof fn.identity === 'string')
    && (fn.bodyBindings === undefined || (fn.bodyBindings !== null && typeof fn.bodyBindings === 'object'
      && !Array.isArray(fn.bodyBindings) && Object.values(fn.bodyBindings).every((binding) => typeof binding === 'string'))))) return false;
  const identities = new Set<string>();
  const names = new Set<string>();
  for (const fn of functions) {
    const name = fn.name.toUpperCase();
    if (names.has(name) || validateCustomFunction(fn, [])) return false;
    names.add(name);
    if (fn.identity !== undefined) {
      if (!fn.identity.trim() || identities.has(fn.identity)) return false;
      identities.add(fn.identity);
    }
    const bindings = fn.bodyBindings ?? {};
    if (sheetIds && (Object.keys(bindings).some((id) => !sheetIds.includes(id))
      || (fn.body.startsWith('=') && sheetIds.some((id) => !Object.prototype.hasOwnProperty.call(bindings, id))))) return false;
    try {
      for (const binding of Object.values(bindings)) requireStoredFormula(binding as string);
    } catch { return false; }
  }
  return true;
}

export function validAuthoritativeFunctions(functions: Workbook['functions'], sheetIds: readonly string[]): boolean {
  return validLifecycleFunctions(functions, sheetIds)
    && functions!.every((fn) => typeof fn.identity === 'string' && fn.identity.trim().length > 0);
}


export function validLifecycleBundle(bundle: { manifest: { revision: number }; documents: { revision: number }[]; dataModels: unknown[]; functions?: Workbook['functions'] }): boolean {
  const revision = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
  return Boolean(bundle.manifest && revision(bundle.manifest.revision) && Array.isArray(bundle.documents)
    && bundle.documents.every((document) => document && revision(document.revision))
    && Array.isArray(bundle.dataModels) && validLifecycleFunctions(bundle.functions));
}
