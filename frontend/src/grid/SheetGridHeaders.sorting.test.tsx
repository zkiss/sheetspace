import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SheetGridHeaders } from './SheetGridHeaders';

it('shows descending and ascending indicators on their respective sorted columns', () => {
  const columns = ['a', 'b', 'c'].map((id, durableIndex) => ({ kind: 'saved' as const, id, durableIndex }));
  const virtualColumns = columns.map((_, index) => ({ index, key: index, start: index * 80, end: (index + 1) * 80, size: 80, lane: 0 }));
  render(<SheetGridHeaders columnHeaderRef={createRef()} columns={columns} virtualColumns={virtualColumns}
    sorting={[{ columnId: 'a', direction: 'ascending' }, { columnId: 'b', direction: 'descending' }]} />);
  expect(screen.getByRole('columnheader', { name: 'A' })).toHaveAttribute('aria-sort', 'ascending');
  expect(screen.getByRole('columnheader', { name: 'A' })).toHaveTextContent('A↓');
  expect(screen.getByRole('columnheader', { name: 'B' })).toHaveAttribute('aria-sort', 'descending');
  expect(screen.getByRole('columnheader', { name: 'B' })).toHaveTextContent('B↑');
  expect(screen.getByRole('columnheader', { name: 'C' })).not.toHaveAttribute('aria-sort');
});
