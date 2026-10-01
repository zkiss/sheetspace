import { cellAddressOf } from '@workbook/core/cellIdentity';
import type { SheetDocument, StableCellIdentity } from '@workbook/core/model';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import { projectGridAxes } from '@grid/gridAxisProjection';
import { createSheetGridAxisMetrics } from '@grid/gridAxisMetrics';
import { gridCellReveal } from '@grid/gridCellReveal';
import { SHEET_HEADER_HEIGHT } from '@grid/gridGeometry';
import { clampSheetFrameSize, clampSheetVisualScale } from '@workspace/workspaceGeometry';

/** Outer navigation uses the cell's position after inner scrolling, not frame intersection. */
export function historyRevealTarget(
  sheet: SheetDocument,
  cell: StableCellIdentity,
  scrollport: HTMLElement | null,
  creatingAxes?: CreatingGridAxes,
) {
  const address = cellAddressOf(sheet.content, cell);
  if (!address) return undefined;
  const projection = projectGridAxes(sheet.content, creatingAxes);
  const metrics = createSheetGridAxisMetrics(projection, sheet.presentation);
  const size = clampSheetFrameSize(sheet.frame.size);
  const reveal = gridCellReveal(metrics, {
    row: projection.rows.findIndex((row) => row.kind === 'saved' && row.durableIndex === address.rowIndex),
    column: projection.columns.findIndex((column) => column.kind === 'saved' && column.durableIndex === address.columnIndex),
  }, {
    width: scrollport?.clientWidth || size.width,
    height: scrollport?.clientHeight || size.height - SHEET_HEADER_HEIGHT,
    left: scrollport?.scrollLeft ?? 0,
    top: scrollport?.scrollTop ?? 0,
  });
  if (!reveal.row || !reveal.column) return undefined;
  const scale = clampSheetVisualScale(sheet.frame.visualScale);
  const { x, y } = sheet.frame.position;
  const bodyLeft = scrollport?.offsetLeft ?? 0;
  const bodyTop = scrollport?.offsetTop || SHEET_HEADER_HEIGHT;
  return {
    left: x + (bodyLeft + reveal.column.start) * scale,
    right: x + (bodyLeft + reveal.column.end) * scale,
    top: y + (bodyTop + reveal.row.start) * scale,
    bottom: y + (bodyTop + reveal.row.end) * scale,
  };
}
