import type { Workbook } from '@workbook/core/model';
import type { FunctionReceipt } from '@application/core/functionCommandOwner';
import { validLifecycleBundle } from '@application/core/lifecycleFunctionValidation';

type FunctionWireReceipt<Bundle> = Omit<FunctionReceipt, 'workbook'> & { workbook: Bundle };
type Declaration = Pick<NonNullable<Workbook['functions']>[number], 'name' | 'parameters' | 'body'>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function functionTransport<Bundle extends Parameters<typeof validLifecycleBundle>[0]>(
  request: <T>(url: string, init?: RequestInit) => Promise<T>,
  encode: (workbook: Workbook) => Bundle,
  decode: (bundle: Bundle) => Workbook,
) {
  function receipt(result: FunctionWireReceipt<Bundle>, operationId: string, matchesLineage: (identity: string) => boolean, matchesFirstAdmission: (workbook: Workbook, identity: string) => boolean): FunctionReceipt {
    if (!result || typeof operationId !== 'string' || !uuid.test(operationId)
      || typeof result.operationId !== 'string' || !uuid.test(result.operationId) || result.operationId.toLowerCase() !== operationId.toLowerCase()
      || typeof result.committedIdentity !== 'string' || !result.committedIdentity.trim()
      || typeof result.alreadyCommitted !== 'boolean' || !result.workbook || !validLifecycleBundle(result.workbook)) {
      throw new Error('Invalid function receipt.');
    }
    const workbook = decode(result.workbook);
    if (!matchesLineage(result.committedIdentity) || (!result.alreadyCommitted && !matchesFirstAdmission(workbook, result.committedIdentity))) {
      throw new Error('Invalid function receipt.');
    }
    return { operationId: result.operationId, committedIdentity: result.committedIdentity, alreadyCommitted: result.alreadyCommitted, workbook };
  }
  return {
    setFunction(operationId: string, before: Workbook, declaration: Declaration, previousName?: string): Promise<FunctionReceipt> {
      const previous = before.functions?.find((fn) => fn.name.toLowerCase() === previousName?.toLowerCase());
      const retained = previous && previous.body === declaration.body && previous.parameters.length === declaration.parameters.length
        && previous.parameters.every((parameter, index) => parameter.name === declaration.parameters[index].name);
      return request<FunctionWireReceipt<Bundle>>('/api/workbook/functions', {
        method: 'PUT', body: JSON.stringify({ operationId, before: encode(before), declaration: { name: declaration.name, parameters: declaration.parameters, body: declaration.body }, ...(previousName === undefined ? {} : { previousName }) }),
      }).then((result) => receipt(result, operationId, (identity) => {
        if (previousName !== undefined && !previous) return false;
        return retained ? identity === previous.identity : !(before.functions ?? []).some((fn) => fn.identity === identity);
      }, (workbook, identity) => (workbook.functions?.some((fn) =>
        fn.identity === identity && fn.name === declaration.name && fn.body === declaration.body
        && fn.parameters.length === declaration.parameters.length
        && fn.parameters.every((parameter, index) => parameter.name === declaration.parameters[index].name && parameter.type === declaration.parameters[index].type)) ?? false)
        && (!previous || previous.name.toLowerCase() === declaration.name.toLowerCase()
          || !workbook.functions?.some((fn) => fn.name.toLowerCase() === previous.name.toLowerCase()))));
    },
    deleteFunction(operationId: string, before: Workbook, name: string): Promise<FunctionReceipt> {
      return request<FunctionWireReceipt<Bundle>>('/api/workbook/functions/delete', {
        method: 'POST', body: JSON.stringify({ operationId, before: encode(before), name }),
      }).then((result) => receipt(result, operationId, (identity) => before.functions?.some((fn) =>
        fn.name.toLowerCase() === name.toLowerCase() && fn.identity === identity) ?? false, (workbook, identity) =>
        !workbook.functions?.some((fn) => fn.name.toLowerCase() === name.toLowerCase() || fn.identity === identity)));
    },
  };
}
