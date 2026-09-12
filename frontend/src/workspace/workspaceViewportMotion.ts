import type { WorkspaceViewport } from './workspaceContracts';

/** Sample the browser's interpolated translation/scale while a reveal is displayed. */
export function displayedWorkspaceViewport(plane: HTMLElement | null): WorkspaceViewport | undefined {
  if (plane?.dataset.navigationMotion !== 'smooth') return;
  // Computed transforms serialize as matrices, including while CSS is transitioning.
  const matrix = getComputedStyle(plane).transform.match(/^matrix(3d)?\((.+)\)$/);
  if (!matrix) return;
  const values = matrix[2].split(',').map(Number);
  const is3d = !!matrix[1];
  if (values.length !== (is3d ? 16 : 6) || !values.every(Number.isFinite) || values[0] <= 0) return;
  return { x: values[is3d ? 12 : 4], y: values[is3d ? 13 : 5], scale: values[0] };
}
