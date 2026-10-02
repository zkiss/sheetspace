import { cellAddressOf } from '@workbook/core/cellIdentity';
import type { SheetDocument, StableCellIdentity } from '@workbook/core/model';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import { projectGridAxes } from '@grid/gridAxisProjection';
import { createSheetGridAxisMetrics } from '@grid/gridAxisMetrics';
import { gridCellReveal } from '@grid/gridCellReveal';
import { clampSheetFrameSize, clampSheetVisualScale, sheetFrameBodyGeometry } from '@workspace/workspaceGeometry';

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
  const body = sheetFrameBodyGeometry(sheet.frame.size);
  // offsetTop/Left are rounded and relative to the offset parent's padding edge,
  // not the frame's outer border. Rect differences also survive nested transforms.
  const frameRect = scrollport?.closest('.sheet-frame')?.getBoundingClientRect();
  const bodyRect = scrollport?.getBoundingClientRect();
  const renderedScale = frameRect?.width ? frameRect.width / size.width : 0;
  const bodyLeft = renderedScale && bodyRect ? (bodyRect.left - frameRect!.left) / renderedScale : body.left;
  const bodyTop = renderedScale && bodyRect ? (bodyRect.top - frameRect!.top) / renderedScale : body.top;
  const reveal = gridCellReveal(metrics, {
    row: projection.rows.findIndex((row) => row.kind === 'saved' && row.durableIndex === address.rowIndex),
    column: projection.columns.findIndex((column) => column.kind === 'saved' && column.durableIndex === address.columnIndex),
  }, {
    width: scrollport?.clientWidth || body.width,
    height: scrollport?.clientHeight || body.height,
    left: scrollport?.scrollLeft ?? 0,
    top: scrollport?.scrollTop ?? 0,
  });
  if (!reveal.row || !reveal.column) return undefined;
  const scale = clampSheetVisualScale(sheet.frame.visualScale);
  const { x, y } = sheet.frame.position;
  return {
    left: x + (bodyLeft + reveal.column.start) * scale,
    right: x + (bodyLeft + reveal.column.end) * scale,
    top: y + (bodyTop + reveal.row.start) * scale,
    bottom: y + (bodyTop + reveal.row.end) * scale,
  };
}
