import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { createGridAxisMetrics, createSheetGridAxisMetrics } from './gridAxisMetrics';
import { projectGridAxes } from './gridAxisProjection';
import { gridCellReveal, gridRangeReveal } from './gridCellReveal';

describe('grid range reveal geometry', () => {
  const projection = projectGridAxes(sheetDocument({ id: 'grid', name: 'Grid' }).content);
  const metrics = createSheetGridAxisMetrics(projection);
  const viewport = { width: 238, height: 126, left: 0, top: 0 };

  it('reveals fitting extents beyond an already visible anchor on both axes', () => {
    const reveal = gridRangeReveal(metrics, { start: { row: 2, column: 1 }, end: { row: 4, column: 2 } }, viewport);
    expect(reveal.row!.scroll).toBeCloseTo(52.8);
    expect(reveal.column!.scroll).toBe(76);
    expect(reveal.row!.end - reveal.row!.start).toBeCloseTo(79.2);
    expect(reveal.column!.end - reveal.column!.start).toBe(152);
  });

  it('retains nonzero offsets only where the full range is unobscured', () => {
    const range = { start: { row: 2, column: 2 }, end: { row: 4, column: 3 } };
    const reveal = gridRangeReveal(metrics, range, { ...viewport, left: 130, top: 50 });
    expect(reveal.column!.scroll).toBe(130);
    expect(reveal.row!.scroll).toBe(50);
    const hiddenLeadingEdges = gridRangeReveal(metrics, range, { ...viewport, left: 160, top: 60 });
    expect(hiddenLeadingEdges.column!.scroll).toBe(152);
    expect(hiddenLeadingEdges.row!.scroll).toBeCloseTo(52.8);
  });

  it('uses projected variable-size endpoints and clamps at the grid end without rounding', () => {
    const variable = {
      rows: createGridAxisMetrics(projection.rows, 30.3),
      columns: createGridAxisMetrics(projection.columns, 80.2),
    };
    const reveal = gridRangeReveal(variable, { start: { row: 18, column: 8 }, end: { row: 19, column: 9 } }, viewport);
    expect(reveal.row!.scroll).toBeCloseTo(variable.rows.totalSize - (126 - 26.4));
    expect(reveal.column!.scroll).toBeCloseTo(variable.columns.totalSize - (238 - 40));
    expect(reveal.row!.end).toBeCloseTo(126);
    expect(reveal.column!.end).toBeCloseTo(238);
    expect(reveal.row!.end - reveal.row!.start).toBeCloseTo(60.6);
    expect(reveal.column!.end - reveal.column!.start).toBeCloseTo(160.4);
  });

  it.each([0, 60])('uses anchor-cell reveal for oversized ranges (top=%s)', (top) => {
    const start = { row: 2, column: 2 };
    const bounds = { ...viewport, left: 100, top };
    expect(gridRangeReveal(metrics, { start, end: { row: 19, column: 9 } }, bounds))
      .toEqual(gridCellReveal(metrics, start, bounds));
  });

  it('handles fitting and oversized axes independently', () => {
    const reveal = gridRangeReveal(metrics, { start: { row: 2, column: 1 }, end: { row: 19, column: 2 } }, viewport);
    expect(reveal.row!.scroll).toBe(0);
    expect(reveal.column!.scroll).toBe(76);
  });

  it('does not consume a reveal with missing projected endpoints', () => {
    const reveal = gridRangeReveal(metrics, { start: { row: 2, column: 1 }, end: { row: 20, column: 10 } }, viewport);
    expect(reveal.row).toBeUndefined();
    expect(reveal.column).toBeUndefined();
  });
});
