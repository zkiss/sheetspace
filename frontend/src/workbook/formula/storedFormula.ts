export type FormulaSpan = { start: number; end: number };
export type FormulaSlot = {
  id: string;
  kind: 'sheet' | 'column' | 'property' | 'row';
  key: string | number | null;
  status: 'retained' | 'unresolved' | 'replaced';
  targetIds: string[];
};
export type FormulaEndpoint = {
  id: string;
  columnSlotId: string;
  rowSlotId: string;
  anchors: { column: boolean; row: boolean };
};
export type FormulaOrigin = FormulaSpan & { slotId: string | null };
export type FormulaOccurrence = {
  id: string;
  guard: FormulaSpan;
  sheetSlotId: string;
  endpoints: FormulaEndpoint[];
  slots: FormulaSlot[];
  origins: FormulaOrigin[];
};
export type StoredFormula = { text: string; occurrences: FormulaOccurrence[] };

declare const storedFormulaContent: unique symbol;
export type StoredFormulaContent = string & { readonly [storedFormulaContent]: true };

const marker = '=~F1';
const invalid = (): never => { throw new Error('Invalid stored formula'); };

/** Only trusted stored-content boundaries call this; user text is never auto-decoded. */
export function decodeStoredFormula(content: string): StoredFormula {
  if (!content.startsWith(marker)) return invalid();
  let payload: unknown;
  try { payload = JSON.parse(content.slice(marker.length)); } catch { return invalid(); }
  return readFormula(payload);
}

function readFormula(payload: unknown): StoredFormula {
  const [text, occurrences] = tuple(payload, 2);
  if (typeof text !== 'string' || !text.startsWith('=')) return invalid();
  const formula = { text, occurrences: array(occurrences).map(readOccurrence) };
  validateLayout(formula);
  return formula;
}

/** Serializes the sole expression together with identity provenance, never a parsed AST. */
export function encodeStoredFormula(formula: StoredFormula): StoredFormulaContent {
  const payload = [formula.text, formula.occurrences.map((occurrence) => [
    occurrence.id, [occurrence.guard.start, occurrence.guard.end], occurrence.sheetSlotId,
    occurrence.endpoints.map((endpoint) => [endpoint.id, endpoint.columnSlotId, endpoint.rowSlotId, endpoint.anchors.column, endpoint.anchors.row]),
    occurrence.slots.map((slot) => [slot.id, slot.kind, slot.key, slot.status, slot.targetIds]),
    occurrence.origins.map((origin) => [origin.start, origin.end, origin.slotId]),
  ])];
  // Encoding and decoding enforce exactly the same persisted contract.
  readFormula(payload);
  return (marker + JSON.stringify(payload)) as StoredFormulaContent;
}

function readOccurrence(value: unknown): FormulaOccurrence {
  const [id, guard, sheetSlotId, endpoints, slots, origins] = tuple(value, 6);
  const [start, end] = tuple(guard, 2);
  const occurrence: FormulaOccurrence = {
    id: identifier(id), guard: { start: offset(start), end: offset(end) }, sheetSlotId: identifier(sheetSlotId),
    endpoints: array(endpoints).map(readEndpoint), slots: array(slots).map(readSlot),
    origins: array(origins).map((origin) => {
      const [start, end, slotId] = tuple(origin, 3);
      return { start: offset(start), end: offset(end), slotId: slotId === null ? null : identifier(slotId) };
    }),
  };
  const slotById = new Map(occurrence.slots.map((slot) => [slot.id, slot]));
  unique(occurrence.slots.map((slot) => slot.id));
  unique(occurrence.endpoints.map((endpoint) => endpoint.id));
  if (slotById.get(occurrence.sheetSlotId)?.kind !== 'sheet' || occurrence.endpoints.length > 2) return invalid();
  const usedSlots = new Set([occurrence.sheetSlotId]);
  for (const endpoint of occurrence.endpoints) {
    const column = slotById.get(endpoint.columnSlotId)?.kind;
    if ((column !== 'column' && column !== 'property') || slotById.get(endpoint.rowSlotId)?.kind !== 'row'
      || usedSlots.has(endpoint.columnSlotId) || usedSlots.has(endpoint.rowSlotId)) return invalid();
    usedSlots.add(endpoint.columnSlotId);
    usedSlots.add(endpoint.rowSlotId);
  }
  if (occurrence.origins.some((origin) => origin.slotId !== null && !slotById.has(origin.slotId))) return invalid();
  return occurrence;
}

function readEndpoint(value: unknown): FormulaEndpoint {
  const [id, columnSlotId, rowSlotId, column, row] = tuple(value, 5);
  if (typeof column !== 'boolean' || typeof row !== 'boolean') return invalid();
  return { id: identifier(id), columnSlotId: identifier(columnSlotId), rowSlotId: identifier(rowSlotId), anchors: { column, row } };
}

function readSlot(value: unknown): FormulaSlot {
  const [id, kind, key, status, targets] = tuple(value, 5);
  if (kind !== 'sheet' && kind !== 'column' && kind !== 'property' && kind !== 'row') return invalid();
  if (status !== 'retained' && status !== 'unresolved' && status !== 'replaced') return invalid();
  if (key !== null) {
    if (kind === 'sheet' || kind === 'property') { if (typeof key !== 'string') return invalid(); }
    else if (typeof key !== 'number' || !Number.isSafeInteger(key) || key < (kind === 'row' ? 1 : 0)) return invalid();
  }
  const targetIds = array(targets).map(identifier);
  if (targetIds.length !== (status === 'retained' ? kind === 'property' ? 2 : 1 : 0)) return invalid();
  return { id: identifier(id), kind, key: key as FormulaSlot['key'], status, targetIds };
}

function validateLayout(formula: StoredFormula): void {
  unique(formula.occurrences.map((occurrence) => occurrence.id));
  let previousEnd = 0;
  for (const occurrence of formula.occurrences) {
    const { guard, origins } = occurrence;
    if (guard.start < previousEnd || guard.start >= guard.end || guard.end > formula.text.length) return invalid();
    previousEnd = guard.end;
    let ownedEnd = guard.start;
    let previous: FormulaOrigin | undefined;
    for (const origin of origins) {
      if (origin.start < guard.start || origin.end > guard.end || origin.start > origin.end
        || origin.start < ownedEnd || (previous && compareFormulaOrigins(previous, origin) >= 0)) return invalid();
      ownedEnd = origin.end;
      previous = origin;
    }
  }
}

export function compareFormulaOrigins(left: FormulaOrigin, right: FormulaOrigin): number {
  return left.start - right.start || left.end - right.end || compareLabels(left.slotId, right.slotId);
}

function compareLabels(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left < right ? -1 : 1;
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : invalid(); }
function tuple(value: unknown, length: number): unknown[] {
  const values = array(value);
  return values.length === length ? values : invalid();
}
function identifier(value: unknown): string { return typeof value === 'string' && value.trim() ? value : invalid(); }
function offset(value: unknown): number { return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647 ? value : invalid(); }
function unique(ids: string[]): void { if (new Set(ids).size !== ids.length) invalid(); }
