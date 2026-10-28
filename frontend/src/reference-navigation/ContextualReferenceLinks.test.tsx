import { createRef, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextualReferenceLinks } from '@reference-navigation/ContextualReferenceLinks';
import type { FormulaInspectionReference } from '@workbook/formula/formulaInspectionContracts';
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
    expect(canvas.closest('[data-testid=workspace-surface]')).toBeTruthy();
    expect(canvas.querySelector('line')).toHaveAttribute('x1', '40');
    const link = screen.getByRole('button', { name: 'Navigate to @Source!A[1]' });
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: 'Enter' });

    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith(reference);
    expect(link).toHaveAttribute('stroke-width', '12');
  });

  it('does not draw an unavailable endpoint', () => {
    render(<ContextualReferenceLinks onNavigate={vi.fn()} references={[{ contextual: { reference, color: '#12ab34' }, geometry: { kind: 'unavailable', reason: 'offscreen' } }]} source={source} visible />);
    expect(screen.queryByRole('button', { name: 'Navigate to @Source!A[1]' })).not.toBeInTheDocument();
    expect(document.querySelector('.contextual-reference-canvas line')).toBeNull();
  });

  it('shows hovered paths when show-all is off', () => {
    const { rerender } = render(<ContextualReferenceLinks onNavigate={vi.fn()} references={[{ contextual: { reference, color: '#12ab34' }, geometry: target }]} source={source} visible={false} />);
    expect(screen.queryByRole('button', { name: 'Navigate to @Source!A[1]' })).not.toBeInTheDocument();
    rerender(<ContextualReferenceLinks onNavigate={vi.fn()} references={[{ contextual: { reference, color: '#12ab34' }, geometry: target }]} source={source} visible={false} hoveredSourceSpan={reference.sourceSpan} />);
    expect(screen.getByRole('button', { name: 'Navigate to @Source!A[1]' })).toBeInTheDocument();
  });

  it('marks offscreen endpoints at the surface edge', () => {
    render(<ContextualReferenceLinks onNavigate={vi.fn()} references={[{ contextual: { reference, color: '#12ab34' }, geometry: { kind: 'offscreen', target: { x: 500, y: 40 } } }]} source={source} surfaceSize={{ width: 200, height: 200 }} visible />);
    expect(document.querySelector('.contextual-reference-offscreen-marker')).toHaveAttribute('cx', '188');
    expect(document.querySelector('.contextual-reference-offscreen-marker')).toHaveAttribute('fill', '#12ab34');
    expect(screen.getByRole('button', { name: 'Navigate to @Source!A[1]' })).toBeInTheDocument();
  });

  it('anchors a miniature target to its frame and marks editor emphasis', () => {
    render(<ContextualReferenceLinks onNavigate={vi.fn()} references={[{ contextual: { reference, color: '#12ab34' }, geometry: { kind: 'overview', rect: target.rect } }]} source={source} visible pulseSourceSpan={reference.sourceSpan} editorActive />);

    const line = document.querySelector('.contextual-reference-visible-line');
    expect(line).toHaveClass('contextual-reference-line-editor');
    expect(line).toHaveAttribute('x1', '40');
    expect(line).toHaveAttribute('x2', '120');
    expect(document.querySelector('.contextual-reference-pulse')).toHaveClass('contextual-reference-pulse-editor');
    expect(document.querySelector('.contextual-reference-overview-target')).toHaveAttribute('width', '40');
  });

  it('clears proximity emphasis when editing starts and ignores further pointer movement', () => {
    const props = { onNavigate: vi.fn(), references: [{ contextual: { reference, color: '#12ab34' }, geometry: target }], source, visible: true };
    const { rerender } = render(<ContextualReferenceLinks {...props} />);
    const svg = document.querySelector('svg')!;
    const line = svg.querySelector('.contextual-reference-visible-line')!;
    const pulse = svg.querySelector('.contextual-reference-pulse')!;
    Object.defineProperty(svg, 'getScreenCTM', { value: () => ({}) });
    for (const [name, value] of Object.entries({ x1: 40, y1: 40, x2: 120, y2: 140 })) {
      Object.defineProperty(line, name, { value: { baseVal: { value } } });
    }
    vi.stubGlobal('DOMPoint', class {
      constructor(public x: number, public y: number) {}
      matrixTransform() { return this; }
    });
    try {
      fireEvent(window, new MouseEvent('pointermove', { clientX: 40, clientY: 40 }));
      expect(line).toHaveStyle({ strokeWidth: '6px', strokeOpacity: '1' });
      expect(pulse).toHaveClass('contextual-reference-pulse-active');

      rerender(<ContextualReferenceLinks {...props} editorActive />);
      fireEvent(window, new MouseEvent('pointermove', { clientX: 40, clientY: 40 }));
      expect(line).not.toHaveStyle({ strokeWidth: '6px' });
      expect(pulse).not.toHaveClass('contextual-reference-pulse-active');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('labels a broken reference but prevents navigation and misleading geometry', () => {
    const brokenReference = { ...reference, text: '@#REF!A[1]', broken: true, navigable: false };
    render(<ContextualReferenceLinks onNavigate={vi.fn()} onToggle={vi.fn()} references={[{ contextual: { reference: brokenReference, color: '#12ab34' }, geometry: { kind: 'unavailable', reason: 'broken' } }]} source={source} visible />);

    expect(screen.queryByRole('button', { name: 'Navigate to @#REF!A[1]' })).not.toBeInTheDocument();
    expect(document.querySelector('.contextual-reference-canvas line')).toBeNull();
    expect(document.querySelector('.contextual-reference-canvas rect')).toBeNull();
  });
});
