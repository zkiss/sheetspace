import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument } from '@test-support/workbookFactories';
import { NumberFormatControls } from './NumberFormatControls';

function scenario() {
  const sheet = sheetDocument({ id: 'visuals', name: 'Visuals', rowCount: 1, columnCount: 2 });
  const endpoint = (index: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[index]! } });
  const selection = { mode: 'cells' as const, anchor: endpoint(0), extent: endpoint(0) };
  const styled = { ...sheet, presentation: { ...sheet.presentation, formatOverrides: {
    rows: {}, columns: {}, cells: {
      [cellIdentityKey(endpoint(0).cell)]: { textColor: '#000000' as const, fillColor: '#000000' as const, horizontalAlignment: 'right' as const },
      [cellIdentityKey(endpoint(1).cell)]: { textColor: '#ffffff' as const, fillColor: '#ffffff' as const },
    },
  } } };
  return { sheet, styled, selection, endpoint };
}

function expectSwatch(trigger: HTMLElement, background: string, foreground: string) {
  expect(trigger.querySelector('.colour-picker-trigger-swatch')).toHaveStyle(`--colour-swatch: ${background}; color: ${foreground}`);
}

describe('toolbar formatting visuals', () => {
  it('keeps the two colour purposes recognizable on the same displayed colour', () => {
    const { styled, selection } = scenario();
    render(<NumberFormatControls sheet={styled} selection={selection} onWrite={vi.fn()} />);
    const text = screen.getByRole('button', { name: 'Text colour: #000000' });
    const fill = screen.getByRole('button', { name: 'Fill colour: #000000' });
    expect(text.querySelector('[data-colour-purpose="text"]')).toHaveTextContent('A');
    expect(fill.querySelector('[data-colour-purpose="fill"]')).toBeInTheDocument();
    expect(fill.querySelector('ellipse')).toBeInTheDocument();
    expectSwatch(text, '#000000', '#ffffff');
    expectSwatch(fill, '#000000', '#ffffff');
    expect(text.querySelector('.colour-picker-trigger-swatch')).toHaveAttribute('aria-hidden', 'true');
    expect(fill.querySelector('.colour-picker-trigger-swatch')).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses varied line lengths with the correct common edge or centre, preserving alignment actions', () => {
    const { styled, selection } = scenario();
    const onWrite = vi.fn();
    render(<NumberFormatControls sheet={styled} selection={selection} onWrite={onWrite} />);
    for (const [label, value] of [['Align left', 'left'], ['Align center', 'center'], ['Align right', 'right']] as const) {
      const button = screen.getByRole('button', { name: label });
      const svg = button.querySelector('svg')!;
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      const lines = [...svg.querySelectorAll('path')].map((path) => {
        expect(path).toHaveAttribute('stroke', 'currentColor');
        const [, x, y, width] = /^M(\d+) (\d+)h(\d+)$/.exec(path.getAttribute('d')!)!;
        return { x: Number(x), y: Number(y), width: Number(width) };
      });
      expect(lines).toHaveLength(4);
      expect(new Set(lines.map((line) => line.width)).size).toBeGreaterThan(1);
      expect(lines.map((line) => line.y)).toEqual([3, 6, 9, 12]);
      expect(new Set(lines.map((line) => value === 'left' ? line.x : value === 'center' ? line.x + line.width / 2 : line.x + line.width))).toEqual(new Set([value === 'left' ? 2 : value === 'center' ? 8 : 14]));
      expect(button).toHaveAttribute('aria-pressed', String(value === 'right'));
      fireEvent.click(button);
      expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId: cellIdentityKey(selection.anchor.cell), properties: { horizontalAlignment: value } }]);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Automatic alignment' }));
    expect(onWrite).toHaveBeenLastCalledWith([{ scope: 'cell', targetId: cellIdentityKey(selection.anchor.cell), properties: { horizontalAlignment: 'general' } }]);
  });

  it.each(['Text colour', 'Fill colour'])('updates %s contrast with drafts and selection, then restores the original pairing on cancellation', (label) => {
    const { styled, selection, endpoint } = scenario();
    const onWrite = vi.fn();
    const { rerender } = render(<NumberFormatControls sheet={styled} selection={selection} onWrite={onWrite} />);
    const trigger = screen.getByRole('button', { name: `${label}: #000000` });
    expect(trigger).toHaveAccessibleDescription(`${label}: one effective value; explicit local override`);
    expectSwatch(trigger, '#000000', '#ffffff');
    fireEvent.click(trigger);
    fireEvent.input(screen.getByLabelText('Custom colour'), { target: { value: '#ffffff' } });
    expect(trigger).toHaveAccessibleName(`${label}: #ffffff`);
    expectSwatch(trigger, '#ffffff', '#000000');
    fireEvent.change(screen.getByLabelText('Custom colour'), { target: { value: '#0000ff' } });
    expectSwatch(trigger, '#0000ff', '#ffffff');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inherit' }), { key: 'Escape' });
    expectSwatch(trigger, '#000000', '#ffffff');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onWrite).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.input(screen.getByLabelText('Custom colour'), { target: { value: '#abcdef' } });
    expectSwatch(trigger, '#abcdef', '#000000');
    fireEvent.pointerDown(document.body);
    expectSwatch(trigger, '#000000', '#ffffff');
    rerender(<NumberFormatControls sheet={styled} selection={{ ...selection, anchor: endpoint(1), extent: endpoint(1) }} onWrite={onWrite} />);
    expectSwatch(screen.getByRole('button', { name: `${label}: #ffffff` }), '#ffffff', '#000000');
  });

  it('keeps inherited, mixed and explicit default markers instead of giving them colour-purpose swatches', () => {
    const { sheet, styled, selection, endpoint } = scenario();
    const onWrite = vi.fn();
    const { rerender } = render(<NumberFormatControls sheet={sheet} selection={selection} onWrite={onWrite} />);
    for (const label of ['Text colour', 'Fill colour']) {
      const trigger = screen.getByRole('button', { name: `${label}: inherited` });
      expect(trigger.querySelector('svg')).toBeInTheDocument();
      expect(trigger.querySelector('.colour-picker-trigger-swatch')).toBeNull();
    }
    rerender(<NumberFormatControls sheet={styled} selection={{ ...selection, extent: endpoint(1) }} onWrite={onWrite} />);
    for (const label of ['Text colour', 'Fill colour']) {
      const trigger = screen.getByRole('button', { name: `${label}: mixed` });
      expect(trigger.querySelector('.colour-picker-mixed-indicator')).toHaveTextContent('—');
      expect(trigger.querySelector('.colour-picker-trigger-swatch')).toBeNull();
    }
    const defaults = { ...sheet, presentation: { ...sheet.presentation, formatOverrides: {
      rows: {}, columns: {}, cells: { [cellIdentityKey(selection.anchor.cell)]: { textColor: 'automatic' as const, fillColor: 'none' as const } },
    } } };
    rerender(<NumberFormatControls sheet={defaults} selection={selection} onWrite={onWrite} />);
    for (const label of ['Text colour', 'Fill colour']) {
      const trigger = screen.getByRole('button', { name: `${label}: no colour` });
      expect(trigger.querySelector('rect')).toBeInTheDocument();
      expect(trigger.querySelector('.colour-picker-trigger-swatch')).toBeNull();
    }
  });
});
