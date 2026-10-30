import type { DataModel, Workbook } from '../core/model';
import { formatPropertyReferenceToken, parseUserFormulaSyntax } from './syntax';

/** Project declaration references through the previous property identities, not the new names. */
export function projectRenamedModelFormulas(workbook: Workbook, previous: DataModel, next: DataModel): DataModel {
  const names = new Map(previous.columns.map((property) => [property.name, property.id]));
  const renamed = new Map(next.columns.map((property) => [property.id, property.name]));
  return { ...next, columns: next.columns.map((property) => {
    if (property.kind !== 'calculated') return property;
    const syntax = parseUserFormulaSyntax(property.formula, (qualifier, name) => {
      if (!qualifier) return names.has(name);
      const sheet = Object.values(workbook.documents).find((candidate) => candidate.name === qualifier);
      return sheet?.modelId === previous.id && names.has(name) && Boolean(sheet.modelColumnBindings?.[names.get(name)!]);
    });
    const edits = syntax.referenceLexemes.flatMap((lexeme) => lexeme.endpoints.flatMap((endpoint) => {
      if (endpoint.kind !== 'named') return [];
      if (lexeme.qualifier) {
        const sheet = Object.values(workbook.documents).find((candidate) => candidate.name === lexeme.qualifier!.value);
        if (sheet?.modelId !== previous.id || !sheet.modelColumnBindings?.[names.get(endpoint.value.propertyName) ?? '']) return [];
      }
      const id = names.get(endpoint.value.propertyName);
      const name = id && renamed.get(id);
      return name && name !== endpoint.value.propertyName ? [{ ...endpoint.payloadSpans.column, text: formatPropertyReferenceToken(name) }] : [];
    }));
    return { ...property, formula: edits.sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), property.formula) };
  }) };
}
