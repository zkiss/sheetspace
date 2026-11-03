import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { workbookWithSheets, smallSheetDocument } from '@test-support/workbookFactories';
import { measuredElementGeometry } from '@test-support/domGeometry';
import { App } from './App';

describe('workspace viewport reporting', () => {
  it('keeps the grid viewport observer on an App rerender', () => {
    const observe = vi.spyOn(ResizeObserver.prototype, 'observe');
    try {
      const workbook = workbookWithSheets([smallSheetDocument({ id: 'sheet', name: 'Sheet' })]);
      const app = <App initialWorkbook={workbook} />;
      const { container, rerender, unmount } = render(app);
      const body = container.querySelector<HTMLElement>('.sheet-frame-body');
      expect(body).not.toBeNull();
      expect(screen.getByLabelText('Sheet Sheet')).toBeInTheDocument();
      const observations = () => observe.mock.calls.filter(([element]) => element === body).length;
      const initial = observations();
      expect(initial).toBeGreaterThan(0);

      rerender(<App initialWorkbook={workbook} />);

      expect(observations()).toBe(initial);
      act(() => { measuredElementGeometry(body!, { width: 240, height: 160 }); });
      body!.scrollLeft = 10;
      body!.scrollTop = 20;
      fireEvent.scroll(body!);
      expect(observations()).toBe(initial);
      unmount();
    } finally {
      observe.mockRestore();
    }
  });
});
