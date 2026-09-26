import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SheetOverview, MAX_SHEET_OVERVIEW_SAMPLES, projectSheetOverview } from '@workspace/SheetOverview';
import { sheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';

describe('SheetOverview', () => {
  it('projects sparse large-sheet identity and content into a bounded non-grid body', () => {
    const cells = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [
      `A${index + 1}`,
      index === 0 ? 'Revenue forecast' : `value-${index + 1}`,
    ]));
    cells.CV10000 = 'far edge';
    const sheet = tabularProjection(sheetDocument({
      cells,
      columnCount: 100,
      id: 'sheet-large',
      name: 'Large plan',
      rowCount: 10_000,
    }));
    const onSelect = vi.fn();

    render(<SheetOverview isActive={false} onSelect={onSelect} sheet={sheet} />);

    expect(screen.getByText('Large plan')).toBeInTheDocument();
    expect(screen.getByText('10,000 × 100')).toBeInTheDocument();
    expect(screen.getByText('Revenue forecast')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-overview-sample-address]')).toHaveLength(MAX_SHEET_OVERVIEW_SAMPLES);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sheet-grid-cell')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select sheet Large plan overview' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(projectSheetOverview(sheet)).toHaveLength(MAX_SHEET_OVERVIEW_SAMPLES);
  });
});
