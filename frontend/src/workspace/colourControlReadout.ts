import type { AppearanceControlState } from './appearanceControlState';

export type ColourMode = 'colour' | 'inherited' | 'none' | 'mixed';

/** Axis controls edit axis settings; cell controls retain their effective-value readout. */
export function colourControlReadout(
  state: AppearanceControlState['textColor'] | AppearanceControlState['fillColor'],
  mode: 'cells' | 'rows' | 'columns',
  fallback: `#${string}`,
): { colour: `#${string}`; status: ColourMode; scopeDescription?: string } {
  const axisSelection = mode !== 'cells';
  const value = axisSelection ? state.localValue : state.localValue ?? state.value;
  const status: ColourMode = state.localOverrideState === 'mixed' || (!axisSelection && state.value === null)
    ? 'mixed'
    : state.localOverrideState === 'inherited' ? 'inherited'
      : value === 'automatic' || value === 'none' ? 'none' : 'colour';
  return {
    colour: value?.startsWith('#') ? value as `#${string}` : fallback,
    status,
    scopeDescription: axisSelection
      ? `${mode === 'rows' ? 'row' : 'column'}-level ${state.localOverrideState === 'explicit' ? value : status}`
      : undefined,
  };
}
