import type { CellAppearance } from '@workbook/core/model';

export type LocalOverrideState = 'inherited' | 'explicit' | 'mixed';
export type AppearancePropertyControlState<Value> = {
  /** The common effective value, or null when the selection has mixed values. */
  value: Value | null;
  /** The common local override, independent of effective cell values. */
  localValue: Value | null;
  /** Whether the selected targets inherit, explicitly set, or mix local values. */
  localOverrideState: LocalOverrideState;
  hasLocalOverrides: boolean;
};
export type AppearanceControlState = { [Property in keyof CellAppearance]-?: AppearancePropertyControlState<NonNullable<CellAppearance[Property]>> };
