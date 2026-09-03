import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSurface } from '@workspace/WorkspaceSurface';

afterEach(cleanup);

function renderSurface(hasSheets = true) {
  const surfaceRef = createRef<HTMLElement>();
  const interactions = {
    onContextMenu: vi.fn(),
    onPointerCancel: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onWheel: vi.fn(),
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
    fireEvent.pointerDown(surface);
    fireEvent.pointerMove(surface);
    fireEvent.pointerUp(surface);
    fireEvent.pointerCancel(surface);
    fireEvent.wheel(surface);

    expect(interactions.onContextMenu).toHaveBeenCalledOnce();
    expect(interactions.onPointerDown).toHaveBeenCalledOnce();
    expect(interactions.onPointerMove).toHaveBeenCalledOnce();
    expect(interactions.onPointerUp).toHaveBeenCalledOnce();
    expect(interactions.onPointerCancel).toHaveBeenCalledOnce();
    expect(interactions.onWheel).toHaveBeenCalledOnce();
    expect(surfaceRef.current).toBe(surface);
    expect(screen.getByText('Sheet content')).toBeInTheDocument();
    expect(screen.getByText('Sheet menu')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-plane')).toHaveStyle({
      transform: 'translate(24px, -12px) scale(1.5)',
    });
  });

  it('shows empty guidance from current composition state', () => {
    renderSurface(false);

    expect(screen.getByText(/Right-click the workspace/)).toBeInTheDocument();
  });
});
