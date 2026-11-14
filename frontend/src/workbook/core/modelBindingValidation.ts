import type { DataModel, SheetDocument } from './model';

export function modelBindingError(document: SheetDocument, models: Readonly<Record<string, DataModel>>): string | undefined {
  if (document.modelId !== undefined && !Object.prototype.hasOwnProperty.call(models, document.modelId)) {
    return `sheet ${document.id} references unknown data model ${document.modelId}`;
  }
  const model = document.modelId === undefined ? undefined : models[document.modelId];
  if (Object.keys(document.modelColumnBindings ?? {}).some((propertyId) => !model?.columns.some((property) => property.id === propertyId))) {
    return `invalid model column bindings for sheet ${document.id}`;
  }
  return undefined;
}
