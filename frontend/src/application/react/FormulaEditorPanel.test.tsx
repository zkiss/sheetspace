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

  it('cancels on Escape after input with no visible completion', () => {
    const cancel = vi.fn();
    render(<Editor onCancel={cancel} />);
    const input = screen.getByLabelText('Test formula');

    fireEvent.change(input, { target: { value: '=1' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('focuses an explicitly opened editor and reports hovered reference values', () => {
    const valueResolver: FormulaReferenceResolver = { ...resolver, coordinateAt: () => ({ columnId: 'column', rowId: 'row' }) };
    render(<FormulaEditorPanel ariaLabel="Hover formula" autoFocus onApply={vi.fn()} onCancel={vi.fn()} onRawChange={vi.fn()} raw="=@A[1]" referenceValues={() => ({ kind: 'number', value: 42 })} resolver={valueResolver} sheetNames={[]} />);

    expect(screen.getByLabelText('Hover formula')).toHaveFocus();
    fireEvent.mouseEnter(screen.getByText('@A[1]'));
    expect(screen.getByText('42')).toBeVisible();
  });

  it('renders distinct token classes for functions, literals, operators, and references', () => {
    const tokenResolver: FormulaReferenceResolver = { ...resolver, coordinateAt: () => ({ columnId: 'column', rowId: 'row' }) };
    render(<FormulaEditorPanel ariaLabel="Syntax formula" onApply={vi.fn()} onCancel={vi.fn()} onRawChange={vi.fn()} raw="=SUM(@A[1], 2) + 3" resolver={tokenResolver} sheetNames={[]} />);

    expect(document.querySelector('.formula-syntax-token-function')).toHaveTextContent('SUM');
    expect(document.querySelector('.formula-syntax-token-literal')).toHaveTextContent('2');
    expect(document.querySelector('.formula-syntax-token-operator')).toHaveTextContent('+');
    expect(document.querySelector('.formula-syntax-token-reference')).toHaveTextContent('@A[1]');
  });

  it('disables formatting for an incomplete formula draft', () => {
    render(<FormulaEditorPanel ariaLabel="Incomplete formula" onApply={vi.fn()} onCancel={vi.fn()} onRawChange={vi.fn()} raw="=SUM(" resolver={resolver} sheetNames={[]} />);

    expect(screen.getByRole('button', { name: 'Format' })).toBeDisabled();
  });
});
