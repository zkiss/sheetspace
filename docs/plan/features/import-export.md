# Import And Export

## Purpose

Import and export let users move data into and out of Sheetspace. These formats are exchange capabilities, not constraints on the internal persistence model.

## Feature Scope

- Export and import full workspace state as JSON.
- Import and export CSV per sheet.
- Import and export XLSX workbooks where practical.
- Preserve as much Sheetspace-specific structure as possible when exporting to richer formats.
- Make format limitations clear when importing or exporting formats that cannot represent the full Sheetspace model.

## Open Decisions

- What is the first exchange format?
- Which parts of Sheetspace's spatial model should JSON export preserve?
- How should unsupported XLSX features or Sheetspace-only features be reported?
