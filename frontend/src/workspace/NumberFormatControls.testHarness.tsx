import type { FormatWrite, SheetDocument } from '@workbook/core/model';
import type { FormattingSelection } from '@workbook/read/formattingSelection';
import { NumberFormatControls as ProductionNumberFormatControls } from './NumberFormatControls';
import { useFormattingSelection } from './useFormattingSelection';

/** Test-only owner for isolated control tests. Production ownership lives in Workspace. */
export function NumberFormatControls({
  sheet,
  selection,
  ...props
}: {
  disabled?: boolean;
  onWrite: (writes: readonly FormatWrite[]) => void;
  selection: FormattingSelection | null;
  sheet: SheetDocument | undefined;
}) {
  const projection = useFormattingSelection(sheet, selection);
  return <ProductionNumberFormatControls {...props} projection={projection} selection={selection} />;
}
