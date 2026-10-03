import { appearanceProperties } from '@workbook/core/numberFormat';
import type { CellAppearance } from '@workbook/core/model';

export const formattingProperties = appearanceProperties;
export type FormattingProperty = typeof formattingProperties[number];
type FormattingValue<Property extends FormattingProperty> = NonNullable<CellAppearance[Property]>;

export type FormattingPropertySummary<Property extends FormattingProperty> = {
  effectiveValue: FormattingValue<Property> | null;
  localValue: FormattingValue<Property> | null;
  localOverrideState: 'inherited' | 'explicit' | 'mixed';
  hasLocalOverrides: boolean;
};
export type FormattingSummary = { [Property in FormattingProperty]: FormattingPropertySummary<Property> };
