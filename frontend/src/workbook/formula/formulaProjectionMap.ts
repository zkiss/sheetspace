import type { FormulaOccurrence, FormulaOrigin, FormulaSpan, StoredFormula } from './storedFormula';

export type FormulaProjectionEdit = FormulaSpan & {
  text: string;
  occurrenceId: string;
  slotId: string;
  /** Relative UTF-16 payload bounds inside replacement text (excluding quotes/brackets). */
  payload: FormulaSpan;
};
export type FormulaProjectionMapping = { source: FormulaSpan; projected: FormulaSpan; occurrenceId: string; slotId: string };

/** Known semantic edits, never intentional user replacements. IDs and statuses are unchanged. */
export function mapFormulaProjection(formula: StoredFormula, edits: FormulaProjectionEdit[]): { formula: StoredFormula; mappings: FormulaProjectionMapping[] } {
  const ordered = [...edits].sort((left, right) => left.start - right.start);
  const offset = (position: number, bias: 'before' | 'after') => {
    let delta = 0;
    for (const edit of ordered) {
      if (position < edit.start || position === edit.start && bias === 'before') break;
      if (position >= edit.end) delta += edit.text.length - (edit.end - edit.start);
      else return edit.start + delta + (bias === 'after' ? edit.text.length : 0);
    }
    return position + delta;
  };
  const mappings = ordered.map((edit) => ({ source: { start: edit.start, end: edit.end }, projected: { start: offset(edit.start, 'before'), end: offset(edit.start, 'before') + edit.text.length }, occurrenceId: edit.occurrenceId, slotId: edit.slotId }));
  const occurrences = formula.occurrences.map((occurrence): FormulaOccurrence => {
    const ownEdits = ordered.filter((edit) => edit.occurrenceId === occurrence.id);
    const origins = occurrence.origins.flatMap((origin): FormulaOrigin[] => {
      if (origin.start === origin.end) {
        if (ownEdits.some((edit) => edit.slotId === origin.slotId && edit.start <= origin.start && edit.end >= origin.end)) return [];
        const point = offset(origin.start, 'after');
        return [{ ...origin, start: point, end: point }];
      }
      let cursor = origin.start;
      const pieces: FormulaSpan[] = [];
      for (const edit of ownEdits) {
        if (edit.end <= cursor || edit.start >= origin.end) continue;
        if (cursor < edit.start) pieces.push({ start: cursor, end: edit.start });
        cursor = Math.max(cursor, edit.end);
      }
      if (cursor < origin.end) pieces.push({ start: cursor, end: origin.end });
      return pieces.map((piece) => ({ start: offset(piece.start, 'after'), end: offset(piece.end, 'before'), slotId: origin.slotId }));
    });
    for (const edit of ownEdits) {
      const start = offset(edit.start, 'before');
      if (edit.payload.start) origins.push({ start, end: start + edit.payload.start, slotId: null });
      origins.push({ start: start + edit.payload.start, end: start + edit.payload.end, slotId: edit.slotId });
      if (edit.payload.end < edit.text.length) origins.push({ start: start + edit.payload.end, end: start + edit.text.length, slotId: null });
    }
    origins.sort((left, right) => left.start - right.start || left.end - right.end || (left.slotId ?? '').localeCompare(right.slotId ?? ''));
    return { ...occurrence, guard: { start: offset(occurrence.guard.start, 'after'), end: offset(occurrence.guard.end, 'after') }, origins };
  });
  const text = [...ordered].reverse().reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), formula.text);
  return { formula: { text, occurrences }, mappings };
}
