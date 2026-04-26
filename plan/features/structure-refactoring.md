# Structure Refactoring

MVP importance: Later.

## Purpose

One long-term differentiator is making spreadsheet restructuring safer. Users should be able to split dense sheets, extract related regions, and understand what references will change.

## MVP Slice

- No structural refactoring is required for the MVP.

## MVP Limitations

- No extract-region command.
- No formula rewriting.
- No diff view.
- No move/copy extraction mode.
- No reference rewrite report.

## Long-Term Scope

- Select a rectangular range and extract it into a new sheet.
- Create the new sheet near the original sheet.
- Copy selected values and formulas as the first implementation.
- Later support move-based extraction.
- Rewrite formulas where safe.
- Report formulas that cannot be rewritten safely.
- Support sheet or range diff views for selected tables.

## Initial Refactor Strategy

Start with copy-based extraction:

- Keep the source range unchanged.
- Create a new sheet nearby.
- Copy raw values and formulas into the new sheet.
- Do not attempt formula rewriting.
- Clearly report unsupported rewrite behavior.

## Open Decisions

- Should extraction default to copy or move?
- Should formulas outside the extracted range update automatically?
- What should happen to formulas inside the extracted range that reference cells outside it?
