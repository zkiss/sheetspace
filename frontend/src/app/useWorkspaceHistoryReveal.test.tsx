import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { useWorkspaceHistoryReveal } from './useWorkspaceHistoryReveal';

describe('content history reveal destination', () => {
  it('reports the destination even inside canvas bounds and only once per feedback', () => {
    const sheet = sheetDocument({ id: 'history', name: 'History' });
    const cell = cellIdentityAt(sheet.content, 'A1')!;
    const feedback = {
      identity: 'one', affected: { sheetIds: [sheet.id], cells: [] }, before: [],
      after: [{ sheetId: sheet.id, ...cell, raw: null, display: null }],
    };
    const navigateToTarget = vi.fn();
    const reveal = vi.fn();
    const controller = {
      workspaceSurfaceSize: { width: 1000, height: 1000 },
      workspaceSurfaceRef: { current: document.createElement('div') },
      viewport: { x: 0, y: 0, scale: 1 },
      navigateToTarget,
    };
    const { rerender } = renderHook(() => useWorkspaceHistoryReveal(feedback, false, [sheet], {}, controller, reveal));
    rerender();
    expect(reveal).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith(expect.objectContaining({ sheetId: sheet.id, outsideViewport: false }));
    expect(navigateToTarget).not.toHaveBeenCalled();
  });
});
