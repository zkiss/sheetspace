import type { Workbook } from '../core/model';
import { namedColumns } from '../core/columnNames';
import { formatPropertyReferenceToken, parseUserFormulaSyntax } from './syntax';

export function projectRenamedModelFormulas(before: Workbook, after: Workbook): Workbook {
  const models = Object.fromEntries(Object.entries(after.dataModels ?? {}).map(([id, model]) => {
    const previous = before.dataModels?.[id];
    const resolve = (qualifier: string | undefined, name: string) => {
      if (!qualifier) {
        const property = previous?.columns.find((item) => item.name === name);
        return property && model.columns.find((item) => item.id === property.id)?.name;
      }
      const sheet = Object.values(before.documents).find((item) => item.name === qualifier);
      const nextSheet = sheet && after.documents[sheet.id];
      const target = sheet && namedColumns(before, sheet).find((item) => item.name === name);
      return target && nextSheet && namedColumns(after, nextSheet).find((item) => item.columnId === target.columnId && item.id === target.id)?.name;
    };
    return [id, { ...model, columns: model.columns.map((property) => {
      if (property.kind !== 'calculated') return property;
      const syntax = parseUserFormulaSyntax(property.formula, (qualifier, name) => resolve(qualifier, name) !== undefined);
      const edits = syntax.referenceLexemes.flatMap((lexeme) => lexeme.endpoints.flatMap((endpoint) => {
        if (endpoint.kind !== 'named') return [];
        const name = resolve(lexeme.qualifier?.value, endpoint.value.propertyName);
        return name && name !== endpoint.value.propertyName ? [{ ...endpoint.payloadSpans.column, text: formatPropertyReferenceToken(name) }] : [];
      }));
      return { ...property, formula: edits.sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), property.formula) };
    }) }];
  }));
  return { ...after, dataModels: models };
}
