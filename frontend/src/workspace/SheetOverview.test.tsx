import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SheetOverview, MAX_SHEET_OVERVIEW_SAMPLES, projectSheetOverview } from '@workspace/SheetOverview';
import { sheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';

describe('SheetOverview', () => {
  it('projects sparse large-sheet identity and content into a bounded non-grid body', () => {
    const crowdedCells = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [
      `A${index + 1}`,
      index === 0 ? 'Revenue forecast' : `value-${index + 1}`,
    ]));
    const sheet = tabularProjection(sheetDocument({
      cells: { A1: 'Revenue forecast', CV10000: 'far edge' },
      columnCount: 100,
      id: 'sheet-large',
      name: 'Large plan',
      rowCount: 10_000,
    }));
    const crowdedSheet = tabularProjection(sheetDocument({
      cells: crowdedCells,
      id: 'sheet-crowded',
      name: 'Crowded',
      rowCount: 10_000,
    }));
    const onSelect = vi.fn();

    render(<SheetOverview isActive={false} onSelect={onSelect} screenScale={0.25} sheet={sheet} />);

    expect(screen.getByRole('button', { name: 'Select sheet Large plan overview' })).toHaveAttribute('aria-pressed', 'false');
    const marks = document.querySelectorAll('.sheet-overview-data-mark');
    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveStyle({ left: 'calc(23px + 0% - 0px)', top: 'calc(19px + 0% - 0px)' });
    expect(marks[1]).toHaveStyle({ left: 'calc(23px + 100% - 23px)', top: 'calc(19px + 100% - 19px)' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sheet-grid-cell')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select sheet Large plan overview' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(projectSheetOverview(crowdedSheet)).toHaveLength(MAX_SHEET_OVERVIEW_SAMPLES);
  });

  it('uses sheet-local texture coordinates and bounds projected text on single-cell axes', () => {
    const longValue = 'A value that is deliberately longer than the overview sample limit';
    const sheet = tabularProjection(sheetDocument({
      cells: { A1: longValue },
      columnCount: 1,
      id: 'sheet-single-cell',
      name: 'Single cell',
      rowCount: 1,
    }));
    const { rerender } = render(
      <SheetOverview isActive onSelect={vi.fn()} screenScale={Number.NaN} sheet={sheet} />,
    );

    expect(document.querySelector('.sheet-overview-data-mark')).toHaveStyle({ left: 'calc(23px + 0% - 0px)', top: 'calc(19px + 0% - 0px)' });
    expect(projectSheetOverview(sheet)[0].text).toBe(`${longValue.slice(0, 31)}…`);

    rerender(<SheetOverview isActive onSelect={vi.fn()} screenScale={0} sheet={sheet} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clamps explicit sample limits to the overview bounds', () => {
    const sheet = tabularProjection(sheetDocument({
      cells: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [
        `A${index + 1}`,
        `value-${index + 1}`,
      ])),
      id: 'sheet-sample-limits',
      name: 'Sample limits',
      rowCount: 20,
    }));

    expect(projectSheetOverview(sheet, -1)).toEqual([]);
    expect(projectSheetOverview(sheet, 2.9)).toHaveLength(2);
    expect(projectSheetOverview(sheet, Number.POSITIVE_INFINITY)).toHaveLength(MAX_SHEET_OVERVIEW_SAMPLES);
  });
});
