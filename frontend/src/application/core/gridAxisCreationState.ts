export type CreatingGridAxisSlot = {
  kind: 'creating';
  operationId: string;
  boundary: number;
};

export type CreatingGridAxes = {
  rows: readonly CreatingGridAxisSlot[];
  columns: readonly CreatingGridAxisSlot[];
};
