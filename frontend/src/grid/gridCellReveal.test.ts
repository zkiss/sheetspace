import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { createGridAxisMetrics, createSheetGridAxisMetrics } from './gridAxisMetrics';
import { projectGridAxes } from './gridAxisProjection';
import { gridCellReveal } from './gridCellReveal';

describe('grid cell reveal geometry', () => {
  const projection = projectGridAxes(sheetDocument({ id: 'grid', name: 'Grid' }).content);
  const metrics = createSheetGridAxisMetrics(projection);

  it.each([
    { row: 2, column: 2, left: 160, top: 30 },
    { row: 2, column: 2, left: 100, top: 60 },
    { row: 2, column: 2, left: 160, top: 60 },
    { row: 19, column: 9, left: 0, top: 0 },
  ])('fully reveals fitting cells clear of headers, including fractional grid-end offsets: %o', ({ row, column, left, top }) => {
    const reveal = gridCellReveal(metrics, { row, column }, { width: 238, height: 126, left, top });
    expect(reveal.column!.start).toBeGreaterThanOrEqual(40);
    expect(reveal.column!.end).toBeLessThanOrEqual(238);
    expect(reveal.column!.end - reveal.column!.start).toBeCloseTo(76);
    expect(reveal.row!.start).toBeGreaterThanOrEqual(26.4);
    expect(reveal.row!.end).toBeLessThanOrEqual(126);
    expect(reveal.row!.end - reveal.row!.start).toBeCloseTo(26.4);
    if (left === 100) expect(reveal.column!.scroll).toBe(left);
    if (top === 30) expect(reveal.row!.scroll).toBe(top);
  });

  it('uses fractional variable axis sizes without hiding a leading edge', () => {
    const variable = {
      rows: createGridAxisMetrics(projection.rows, [35.3, 51.4, 44.7, ...Array(17).fill(30)]),
      columns: createGridAxisMetrics(projection.columns, [88.6, 109.7, 90.2, ...Array(7).fill(80)]),
    };
    const reveal = gridCellReveal(variable, { row: 2, column: 2 }, { width: 238, height: 126, left: 200, top: 90 });
    expect(reveal.row!.scroll).toBeCloseTo(86.7);
    expect(reveal.column!.scroll).toBeCloseTo(198.3);
    expect(reveal.row!.end - reveal.row!.start).toBeCloseTo(44.7);
    expect(reveal.column!.end - reveal.column!.start).toBeCloseTo(90.2);
  });

  it.each([{ width: 120, height: 80 }, { width: 20, height: 10 }, { width: 0, height: 0 }])('keeps oversized and empty usable portions finite and ordered: %o', ({ width, height }) => {
    const reveal = gridCellReveal(metrics, { row: 19, column: 9 }, { width, height, left: 0, top: 0 });
    for (const axis of [reveal.row!, reveal.column!]) {
      expect(Number.isFinite(axis.scroll)).toBe(true);
      expect(axis.scroll).toBeGreaterThanOrEqual(0);
      expect(axis.end).toBeGreaterThanOrEqual(axis.start);
    }
  });

  it('leaves a missing axis unresolved instead of moving its scrollport', () => {
    const metrics = createSheetGridAxisMetrics(projectGridAxes(sheetDocument({ id: 'grid', name: 'Grid' }).content));
    const reveal = gridCellReveal(metrics, { row: -1, column: 0 }, { width: 240, height: 160, left: 0, top: 400 });
    expect(reveal.row).toBeUndefined();
    expect(reveal.column).toEqual({ scroll: 0, start: 40, end: 116 });
  });
});
