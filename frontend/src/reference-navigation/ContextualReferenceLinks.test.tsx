import { createRef, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextualReferenceLinks } from '@reference-navigation/ContextualReferenceLinks';
import type { FormulaInspectionReference } from '@reference-navigation/formulaInspection';
import { WorkspaceSurface } from '@workspace/WorkspaceSurface';

const reference: FormulaInspectionReference = {
  kind: 'reference', text: '@Source!A[1]', sourceSpan: { start: 1, end: 13 }, displaySpan: { start: 1, end: 13 }, target: { kind: 'cell', sheetId: 'source' }, broken: false, navigable: true,
};
const source = { kind: 'visible' as const, rect: { left: 20, top: 30, right: 40, bottom: 50 } };
const target = { kind: 'visible' as const, rect: { left: 120, top: 130, right: 160, bottom: 170 } };

function renderInWorkspace(children: ReactNode) {
  return render(<WorkspaceSurface hasSheets isPanningWorkspace={false} navigationMotion={false} overlay={children} viewport={{ x: 0, y: 0, scale: 1 }} workspacePlaneRef={createRef<HTMLDivElement>()} workspaceSurfaceRef={createRef<HTMLElement>()}>{null}</WorkspaceSurface>);
}

describe('ContextualReferenceLinks', () => {
  it('renders surface-relative visible geometry and navigates from its narrow accessible link target', () => {
    const navigate = vi.fn();
    renderInWorkspace(<ContextualReferenceLinks onNavigate={navigate} onToggle={vi.fn()} references={[{ contextual: { reference, color: '#12ab34' }, geometry: target }]} source={source} visible />);

    const canvas = document.querySelector('.contextual-reference-canvas')!;
    expect(canvas.parentElement?.parentElement).toHaveAttribute('data-testid', 'workspace-surface');
    expect(canvas.parentElement?.querySelector('.contextual-reference-controls')).toBeTruthy();
    expect(canvas.parentElement).not.toHaveClass('contextual-reference-controls');
    expect(canvas.querySelector('line')).toHaveAttribute('x1', '30');
    const link = screen.getByRole('button', { name: 'Navigate to @Source!A[1]' });
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: 'Enter' });

    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith(reference);
    expect(link).toHaveAttribute('stroke-width', '12');
  });

  it('keeps unavailable references in the labelled fallback control without drawing a false link', () => {
    render(<ContextualReferenceLinks onNavigate={vi.fn()} onToggle={vi.fn()} references={[{ contextual: { reference, color: '#12ab34' }, geometry: { kind: 'unavailable', reason: 'offscreen' } }]} source={source} visible />);

    expect(screen.getByRole('button', { name: '@Source!A[1], offscreen spatial endpoint' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Navigate to @Source!A[1]' })).not.toBeInTheDocument();
  });
});
