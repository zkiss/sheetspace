import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FormulaReferenceResolver } from '@workbook/formula/reference';
import { FormulaEditorPanel } from './FormulaEditorPanel';

const resolver: FormulaReferenceResolver = {
  currentSheetId: 'sheet',
  sheetByQualifier: () => undefined,
  coordinateAt: () => undefined,
  addressOf: () => undefined,
};

function Editor({ onApply = vi.fn(), onCancel = vi.fn(), onParentKeyDown = vi.fn() }: {
  onApply?: () => void; onCancel?: () => void; onParentKeyDown?: () => void;
}) {
  const [raw, setRaw] = useState('=1');
  return <div onKeyDown={onParentKeyDown}><FormulaEditorPanel ariaLabel="Test formula" onApply={onApply} onCancel={onCancel} onRawChange={setRaw} propertyNames={[]} raw={raw} resolver={resolver} sheetNames={[]} /></div>;
}

describe('FormulaEditorPanel', () => {
  it('keeps rich-editor commands inside the panel while preserving multiline indentation', () => {
    const parent = vi.fn();
    const apply = vi.fn();
    render(<Editor onApply={apply} onParentKeyDown={parent} />);
    const input = screen.getByLabelText('Test formula');

    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input).toHaveValue('  =1');
    expect(parent).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(apply).toHaveBeenCalledOnce();
    expect(parent).not.toHaveBeenCalled();
  });

  it('uses Escape for the panel command without leaking to a containing dialog', () => {
    const parent = vi.fn();
    const cancel = vi.fn();
    render(<Editor onCancel={cancel} onParentKeyDown={parent} />);

    fireEvent.keyDown(screen.getByLabelText('Test formula'), { key: 'Escape' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(parent).not.toHaveBeenCalled();
  });
});
