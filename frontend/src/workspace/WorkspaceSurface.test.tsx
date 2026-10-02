import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSurface } from '@workspace/WorkspaceSurface';

afterEach(cleanup);

function renderSurface(hasSheets = true) {
  const surfaceRef = createRef<HTMLElement>();
  const interactions = {
    onContextMenu: vi.fn(),
    onCreateSheet: vi.fn(),
  };

  render(
    <WorkspaceSurface
      contextMenu={<div>Sheet menu</div>}
      hasSheets={hasSheets}
      isPanningWorkspace
      navigationMotion
      {...interactions}
      viewport={{ scale: 1.5, x: 24, y: -12 }}
      workspaceSurfaceRef={surfaceRef}
      workspacePlaneRef={createRef<HTMLDivElement>()}
    >
      <article>Sheet content</article>
    </WorkspaceSurface>,
  );

  return { interactions, surfaceRef };
}

describe('WorkspaceSurface', () => {
  it('owns workspace events and places supplied sheet and menu content', () => {
    const { interactions, surfaceRef } = renderSurface();
    const surface = screen.getByRole('region', { name: 'Spatial workspace' });

    fireEvent.contextMenu(surface);

    expect(interactions.onContextMenu).toHaveBeenCalledOnce();
    expect(surfaceRef.current).toBe(surface);
    expect(screen.getByText('Sheet content')).toBeInTheDocument();
    expect(screen.getByText('Sheet menu')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-plane')).toHaveStyle({
      transform: 'translate(24px, -12px) scale(1.5)',
    });
  });

  it('shows empty guidance from current composition state', () => {
    const { interactions } = renderSurface(false);

    expect(screen.getByText('Start by placing your first sheet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create your first sheet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create your first sheet' }));
    expect(interactions.onCreateSheet).toHaveBeenCalledOnce();
  });

  it.each([0.001, 0.125, 0.5, 1, 2, 8])('aligns the animated grid to world coordinates at scale %s', (scale) => {
    render(<WorkspaceSurface hasSheets isPanningWorkspace={false} navigationMotion={false} viewport={{ scale, x: -137, y: 89 }} workspaceSurfaceRef={createRef<HTMLElement>()} workspacePlaneRef={createRef<HTMLDivElement>()}>{null}</WorkspaceSurface>);
    const style = screen.getByTestId('workspace-surface').style;
    const major = Number.parseFloat(style.getPropertyValue('--workspace-grid-major-size'));
    const minor = Number.parseFloat(style.getPropertyValue('--workspace-grid-minor-size'));
    const fine = Number.parseFloat(style.getPropertyValue('--workspace-grid-fine-size'));
    expect(major).toBeGreaterThanOrEqual(40);
    expect(major).toBeLessThan(80);
    expect(minor).toBe(major / 2);
    expect(fine).toBe(major / 4);
    expect(style.getPropertyValue('--workspace-grid-major-x')).toBe(`${-137 % major}px`);
    expect(style.getPropertyValue('--workspace-grid-fine-y')).toBe(`${89 % fine}px`);
  });
});
