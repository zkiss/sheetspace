import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    fireEvent.keyDown(screen.getByLabelText('Test formula'), { key: 'Escape', ctrlKey: true });
    expect(cancel).toHaveBeenCalledOnce();
    expect(parent).not.toHaveBeenCalled();
  });

  it('cancels on Escape after input with no visible completion', () => {
    const cancel = vi.fn();
    render(<Editor onCancel={cancel} />);
    const input = screen.getByLabelText('Test formula');

    fireEvent.change(input, { target: { value: '=1' } });
    fireEvent.keyDown(input, { key: 'Escape', ctrlKey: true });

    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['plain', 'ctrl', 'meta'])('heavy Escape with completion open handles %s modifier', (modifier) => {
    const cancel = vi.fn();
    render(<Editor onCancel={cancel} />);
    const input = screen.getByLabelText('Test formula');
    fireEvent.change(input, { target: { value: '=SU' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape', ctrlKey: modifier === 'ctrl', metaKey: modifier === 'meta' });
    if (modifier === 'plain') {
      expect(cancel).not.toHaveBeenCalled();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    } else if (modifier === 'ctrl') {
      expect(cancel).toHaveBeenCalledOnce();
    } else {
      expect(cancel).not.toHaveBeenCalled();
    }
  });

  it('focuses an explicitly opened editor without showing a reference value tooltip', () => {
    const valueResolver: FormulaReferenceResolver = { ...resolver, coordinateAt: () => ({ columnId: 'column', rowId: 'row' }) };
    render(<FormulaEditorPanel ariaLabel="Hover formula" autoFocus onApply={vi.fn()} onCancel={vi.fn()} onRawChange={vi.fn()} raw="=@A[1]" referenceValues={() => ({ kind: 'number', value: 42 })} resolver={valueResolver} sheetNames={[]} />);

    expect(screen.getByLabelText('Hover formula')).toHaveFocus();
    fireEvent.mouseEnter(screen.getByText('@A[1]'));
    expect(screen.queryByText('42')).not.toBeInTheDocument();
  });

  it('renders distinct token classes for functions, literals, operators, and references', () => {
    const tokenResolver: FormulaReferenceResolver = { ...resolver, coordinateAt: () => ({ columnId: 'column', rowId: 'row' }) };
    render(<FormulaEditorPanel ariaLabel="Syntax formula" onApply={vi.fn()} onCancel={vi.fn()} onRawChange={vi.fn()} raw="=SUM(@A[1], 2) + 3" resolver={tokenResolver} sheetNames={[]} />);

    expect(document.querySelector('.formula-syntax-token-function')).toHaveTextContent('SUM');
    expect(document.querySelector('.formula-syntax-token-literal')).toHaveTextContent('2');
    expect(document.querySelector('.formula-syntax-token-operator')).toHaveTextContent('+');
    expect(document.querySelector('.formula-syntax-token-reference')).toHaveTextContent('@A[1]');
  });

  it('uses deterministic distinct colours for resolved reference targets', () => {
    const tokenResolver: FormulaReferenceResolver = { ...resolver, coordinateAt: (_sheet, address) => ({ columnId: `column-${address.columnIndex}`, rowId: `row-${address.rowIndex}` }) };
    render(<FormulaEditorPanel ariaLabel="Reference colours" onApply={vi.fn()} onCancel={vi.fn()} onRawChange={vi.fn()} raw="=@A[1] + @B[1]" resolver={tokenResolver} sheetNames={[]} />);

    const references = document.querySelectorAll<HTMLElement>('.formula-syntax-token-reference');
    expect(references).toHaveLength(2);
    expect(references[0]!.style.color).not.toBe('');
    expect(references[0]!.style.color).not.toBe(references[1]!.style.color);
  });

  it('renders repeated cells and opposite range diagonals in matching colours', () => {
    const tokenResolver: FormulaReferenceResolver = { ...resolver, coordinateAt: (_sheet, address) => ({ columnId: `column-${address.columnIndex}`, rowId: `row-${address.rowIndex}` }) };
    render(<FormulaEditorPanel ariaLabel="Repeated references" onApply={vi.fn()} onCancel={vi.fn()} onRawChange={vi.fn()} raw="=@A[1]+@A[1]+@A[1]:B[2]+@B[1]:A[2]" resolver={tokenResolver} sheetNames={[]} />);

    const references = document.querySelectorAll<HTMLElement>('.formula-syntax-token-reference');
    expect(references).toHaveLength(4);
    expect(references[0]!.style.color).not.toBe('');
    expect(references[0]!.style.color).toBe(references[1]!.style.color);
    expect(references[2]!.style.color).toBe(references[3]!.style.color);
    expect(references[0]!.style.color).not.toBe(references[2]!.style.color);
  });

  it('disables formatting for an incomplete formula draft', () => {
    render(<FormulaEditorPanel ariaLabel="Incomplete formula" onApply={vi.fn()} onCancel={vi.fn()} onRawChange={vi.fn()} raw="=SUM(" resolver={resolver} sheetNames={[]} />);

    expect(screen.getByRole('button', { name: 'Format' })).toBeDisabled();
  });

  it('offers the selected sheet’s columns after completing its name', async () => {
    const sheetResolver: FormulaReferenceResolver = { ...resolver, sheetByQualifier: (name) => name === 'Budget@2026!' ? 'budget' : undefined, namedColumnNames: (id) => id === 'budget' ? ['Revenue', 'Cost'] : [] };
    function SheetEditor() {
      const [raw, setRaw] = useState('=@Bu');
      return <FormulaEditorPanel ariaLabel="Sheet formula" raw={raw} resolver={sheetResolver} sheetNames={['Budget@2026!']} onApply={vi.fn()} onCancel={vi.fn()} onRawChange={setRaw} />;
    }
    render(<SheetEditor />);
    const input = screen.getByRole('textbox', { name: 'Sheet formula' });
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('Expected a formula textarea');
    input.focus();
    input.setSelectionRange(4, 4);
    fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Budget@2026!' }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue' })).toBeInTheDocument());
    expect(input).toHaveValue("=@'Budget@2026!'!");
    expect(screen.getByRole('option', { name: 'Cost' })).toBeInTheDocument();
  });

  it('inserts a qualified quoted column over the full partial name', () => {
    const sheetResolver: FormulaReferenceResolver = { ...resolver, sheetByQualifier: (name) => name === 'Sales@2026' ? 'budget' : undefined, namedColumnNames: (id) => id === 'budget' ? ['Sales@total'] : ['Sales@decoy'] };
    function SheetEditor() {
      const [raw, setRaw] = useState("=@'Sales@2026'!'Sales@t");
      return <FormulaEditorPanel ariaLabel="Sheet formula" raw={raw} resolver={sheetResolver} propertyNames={['Sales@decoy']} sheetNames={['Sales@2026']} onApply={vi.fn()} onCancel={vi.fn()} onRawChange={setRaw} />;
    }
    render(<SheetEditor />);
    const input = screen.getByRole('textbox', { name: 'Sheet formula' });
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('Expected a formula textarea');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
    expect(screen.queryByRole('option', { name: 'Sales@decoy' })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Sales@total' }));

    expect(input).toHaveValue("=@'Sales@2026'!'Sales@total'");
    expect(input).toHaveFocus();
  });

  it.each([
    { initial: `=@'Sales"2026'!'Sales"t`, label: 'Sales"total', expected: `=@'Sales"2026'!'Sales"total'` },
    { initial: '=@Revenue-SU', label: 'SUM', expected: '=@Revenue-SUM' },
  ])('completes quoted names and subtraction in the editor', async ({ initial, label, expected }) => {
    const sheetResolver: FormulaReferenceResolver = { ...resolver, sheetByQualifier: (name) => name === 'Sales"2026' ? 'target' : undefined, namedColumnNames: (id) => id === 'target' ? ['Sales"total'] : ['Decoy'] };
    function SheetEditor() {
      const [raw, setRaw] = useState(initial);
      return <FormulaEditorPanel ariaLabel="Completion formula" raw={raw} resolver={sheetResolver} sheetNames={[]} onApply={vi.fn()} onCancel={vi.fn()} onRawChange={setRaw} />;
    }
    render(<SheetEditor />);
    const input = screen.getByRole('textbox', { name: 'Completion formula' }) as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(initial.length, initial.length);
    fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
    fireEvent.mouseDown(screen.getByRole('option', { name: label }));
    await waitFor(() => expect(input).toHaveValue(expected));
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(expected.length);
  });

  it('does not open completion inside a row selector', () => {
    render(<FormulaEditorPanel ariaLabel="Row formula" raw="=@Revenue[1]" resolver={resolver} sheetNames={['Revenue']} onApply={vi.fn()} onCancel={vi.fn()} onRawChange={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Row formula' }) as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(10, 10);
    fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('=@Revenue[1]');
  });

  it('inserts an anchored property instead of a colliding sheet', async () => {
    function AnchoredEditor() {
      const [raw, setRaw] = useState('=@$Bu');
      return <FormulaEditorPanel ariaLabel="Anchored formula" raw={raw} resolver={resolver} sheetNames={['Budget']} propertyNames={['Budget']} onApply={vi.fn()} onCancel={vi.fn()} onRawChange={setRaw} />;
    }
    render(<AnchoredEditor />);
    const input = screen.getByRole('textbox', { name: 'Anchored formula' }) as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(5, 5);
    fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true });
    expect(screen.getAllByRole('option', { name: 'Budget' })).toHaveLength(1);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Budget' }));
    await waitFor(() => expect(input).toHaveValue('=@$Budget'));
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(9);
  });
});
