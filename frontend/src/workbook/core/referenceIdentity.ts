export type FormulaReferenceIdentity =
  | { kind: 'cell'; sheetId: string; rowId: string; columnId: string }
  | { kind: 'range'; sheetId: string; start: { rowId: string; columnId: string }; end: { rowId: string; columnId: string } };

/** A range describes its two durable corners, regardless of how the formula orders them. */
export function rangeReferenceIdentity(
  sheetId: string,
  first: { rowId: string; columnId: string },
  second: { rowId: string; columnId: string },
): FormulaReferenceIdentity {
  const [start, end] = [first, second].sort(compareCoordinates);
  return { kind: 'range', sheetId, start: { ...start! }, end: { ...end! } };
}

/** A resolved target keeps the same colour when its displayed spelling changes. */
export function referenceIdentityColor(identity: FormulaReferenceIdentity | undefined): string | undefined {
  if (!identity) return undefined;
  const key = identity.kind === 'cell'
    ? `${identity.sheetId}:${identity.rowId}:${identity.columnId}`
    : `${identity.sheetId}:${identity.start.rowId}:${identity.start.columnId}:${identity.end.rowId}:${identity.end.columnId}`;
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return referenceColours[hash % referenceColours.length];
}

function compareCoordinates(first: { rowId: string; columnId: string }, second: { rowId: string; columnId: string }) {
  return first.rowId.localeCompare(second.rowId) || first.columnId.localeCompare(second.columnId);
}

const referenceColours = ['#1d4ed8', '#a21caf', '#047857', '#b45309', '#be123c', '#0f766e', '#6d28d9', '#0369a1'] as const;
