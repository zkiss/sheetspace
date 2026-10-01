import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { createSheetGridAxisMetrics } from './gridAxisMetrics';
import { projectGridAxes } from './gridAxisProjection';
import { gridCellReveal } from './gridCellReveal';

describe('grid cell reveal geometry', () => {
  it('leaves a missing axis unresolved instead of moving its scrollport', () => {
    const metrics = createSheetGridAxisMetrics(projectGridAxes(sheetDocument({ id: 'grid', name: 'Grid' }).content));
    const reveal = gridCellReveal(metrics, { row: -1, column: 0 }, { width: 240, height: 160, left: 0, top: 400 });
    expect(reveal.row).toBeUndefined();
    expect(reveal.column).toEqual({ scroll: 0, start: 40, end: 116 });
  });
});
