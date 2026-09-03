import { ColumnId, RowId, TabularContent } from '@workbook/core/model';

export type CreatingGridAxisSlot = {
  kind: 'creating';
  operationId: string;
  boundary: number;
};

export type SavedGridAxisEntry<Id extends string> = {
  kind: 'saved';
  id: Id;
  durableIndex: number;
};

export type GridAxisEntry<Id extends string> = SavedGridAxisEntry<Id> | CreatingGridAxisSlot;

export type GridAxisProjection = {
  rows: readonly GridAxisEntry<RowId>[];
  columns: readonly GridAxisEntry<ColumnId>[];
};

export type CreatingGridAxes = {
  rows: readonly CreatingGridAxisSlot[];
  columns: readonly CreatingGridAxisSlot[];
};

export const emptyCreatingGridAxes: CreatingGridAxes = { rows: [], columns: [] };

export function projectGridAxis<Id extends string>(
  durableIds: readonly Id[],
  creatingSlots: readonly CreatingGridAxisSlot[],
): readonly GridAxisEntry<Id>[] {
  const slotsAtBoundary = new Map<number, CreatingGridAxisSlot[]>();
  for (const slot of creatingSlots) {
    const boundary = Math.max(0, Math.min(durableIds.length, slot.boundary));
    const slots = slotsAtBoundary.get(boundary) ?? [];
    slots.push(slot);
    slotsAtBoundary.set(boundary, slots);
  }

  const axis: GridAxisEntry<Id>[] = [];
  for (let boundary = 0; boundary <= durableIds.length; boundary += 1) {
    axis.push(...(slotsAtBoundary.get(boundary) ?? []));
    const id = durableIds[boundary];
    if (id !== undefined) axis.push({ kind: 'saved', id, durableIndex: boundary });
  }
  return axis;
}

export function projectGridAxes(
  content: TabularContent,
  creatingAxes: CreatingGridAxes = emptyCreatingGridAxes,
): GridAxisProjection {
  return {
    rows: projectGridAxis(content.rows, creatingAxes.rows),
    columns: projectGridAxis(content.columns, creatingAxes.columns),
  };
}
