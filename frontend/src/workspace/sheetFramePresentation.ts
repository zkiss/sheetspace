import type { SheetPresentation } from './maximiseGeometry';
import type { WorkspaceViewport } from './workspaceContracts';

/**
 * Applies a sampled presentation to an already mounted frame. Presentation
 * motion repaints every animation frame; committing the same geometry through
 * React would re-render every mounted sheet grid on each frame.
 */
export function paintSheetFramePresentation(article: HTMLElement, sample: SheetPresentation, viewport: WorkspaceViewport) {
  article.style.left = `${(sample.frame.left - viewport.x) / viewport.scale}px`;
  article.style.top = `${(sample.frame.top - viewport.y) / viewport.scale}px`;
  article.style.width = `${sample.frame.width}px`;
  article.style.height = `${sample.frame.height}px`;
  article.style.transform = `scale(${1 / viewport.scale})`;
  article.style.setProperty('--presentation-chrome', String(sample.chrome));
  const header = article.querySelector<HTMLElement>(':scope > .sheet-frame-header');
  if (header) {
    header.style.height = `${Math.max(0, sample.body.top - sample.frame.top)}px`;
    header.style.opacity = `${sample.chrome}`;
  }
  const body = article.querySelector<HTMLElement>(':scope > .sheet-frame-body');
  if (body) {
    body.style.left = `${sample.body.left - sample.frame.left}px`;
    body.style.top = `${sample.body.top - sample.frame.top}px`;
    body.style.width = `${sample.body.width / sample.tableScale}px`;
    body.style.height = `${sample.body.height / sample.tableScale}px`;
    body.style.transform = `scale(${sample.tableScale})`;
  }
}
