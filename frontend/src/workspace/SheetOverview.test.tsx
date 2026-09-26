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

    expect(screen.getByText('Large plan')).toBeInTheDocument();
    expect(screen.getByText('10,000 × 100')).toBeInTheDocument();
    expect(screen.getByText('Revenue forecast')).toBeInTheDocument();
    expect(screen.getByTestId('sheet-overview-screen')).toHaveStyle({
      height: '25%',
      transform: 'scale(4)',
      width: '25%',
    });
    expect(document.querySelectorAll('[data-overview-sample-address]')).toHaveLength(2);
    expect(document.querySelector('[data-overview-sample-address="A1"]')).toHaveStyle({
      left: '0%', top: '0%', transform: 'translate(0%, 0%)',
    });
    expect(document.querySelector('[data-overview-sample-address="CV10000"]')).toHaveStyle({
      left: '100%', top: '100%', transform: 'translate(-100%, -100%)',
    });
    expect(document.querySelector('[data-overview-sample-address="CV10000"]')).toHaveTextContent('far edge');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sheet-grid-cell')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select sheet Large plan overview' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(projectSheetOverview(crowdedSheet)).toHaveLength(MAX_SHEET_OVERVIEW_SAMPLES);
  });
});
