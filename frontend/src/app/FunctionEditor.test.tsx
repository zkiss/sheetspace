import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FunctionEditor } from './FunctionEditor';

describe('FunctionEditor', () => {
  it('edits and reorders typed parameters and saves malformed body text', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, value: {} });
    render(<FunctionEditor functions={[]} onCancel={vi.fn()} onSave={save} />);
    fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'fibonacci' } });
    fireEvent.click(screen.getByText('+ Add parameter'));
    fireEvent.change(screen.getByLabelText('Parameter 1 name'), { target: { value: 'a' } });
    fireEvent.click(screen.getByText('+ Add parameter'));
    fireEvent.change(screen.getByLabelText('Parameter 2 name'), { target: { value: 'b' } });
    fireEvent.change(screen.getByLabelText('Parameter 2 type'), { target: { value: 'float' } });
    fireEvent.click(screen.getByLabelText('Move parameter 2 up'));
    fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=SUM(' } });
    expect(screen.getByText(/malformed/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ name: 'fibonacci', parameters: [{ name: 'b', type: 'float' }, { name: 'a', type: 'int' }], body: '=SUM(' }, undefined));
  });

  it('retains rejected drafts and reports metadata and save failures', async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, reason: 'persistence-failed' });
    render(<FunctionEditor functions={[]} onCancel={vi.fn()} onSave={save} />);
    fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'SUM' } });
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByRole('alert')).toHaveTextContent('built-in');
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'total' } });
    fireEvent.click(screen.getByText('+ Add parameter'));
    fireEvent.click(screen.getByLabelText('Remove parameter 1'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be saved'));
    expect(screen.getByLabelText('Function name')).toHaveValue('total');
  });

  it.each([
    { name: '1invalid', parameters: [] as string[], message: 'valid function name' },
    { name: 'EXISTING', parameters: [] as string[], message: 'already exists' },
    { name: 'valid', parameters: ['1invalid'], message: 'valid parameter name' },
    { name: 'valid', parameters: ['arg', 'ARG'], message: 'Parameter names must be unique' },
  ])('reports invalid metadata and retains the draft: $message', ({ name, parameters, message }) => {
    const save = vi.fn();
    render(<FunctionEditor functions={[{ identity: 'one', name: 'existing', parameters: [], body: '=1' }]} onCancel={vi.fn()} onSave={save} />);
    fireEvent.change(screen.getByLabelText('Function name'), { target: { value: name } });
    parameters.forEach((parameter, index) => {
      fireEvent.click(screen.getByText('+ Add parameter'));
      fireEvent.change(screen.getByLabelText(`Parameter ${index + 1} name`), { target: { value: parameter } });
    });
    fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=42' } });
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText('Function name')).toHaveValue(name);
    expect(screen.getByLabelText('Formula body')).toHaveValue('=42');
    parameters.forEach((parameter, index) => expect(screen.getByLabelText(`Parameter ${index + 1} name`)).toHaveValue(parameter));
    expect(save).not.toHaveBeenCalled();
  });

  it('submits the draft with the keyboard shortcut', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, value: {} });
    render(<FunctionEditor functions={[]} onCancel={vi.fn()} onSave={save} />);
    fireEvent.change(screen.getByLabelText('Function name'), { target: { value: 'value' } });
    fireEvent.change(screen.getByLabelText('Formula body'), { target: { value: '=42' } });
    fireEvent.keyDown(screen.getByLabelText('Formula body'), { key: 'Enter', ctrlKey: true });
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Function name'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledWith({ name: 'value', parameters: [], body: '=42' }, undefined));
  });
});
