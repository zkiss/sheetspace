# Formula Editor

MVP importance: Later.

## Purpose

Formula editing should eventually support richer interaction than a plain text input. It should help users read, navigate, format, and explain formulas.

## MVP Slice

- The MVP only needs a basic way to enter formulas in cells.
- Advanced editor behavior is out of scope.

## MVP Limitations

- No multiline formula editor.
- No formula indentation or formatting.
- No formula comments.
- No autocomplete.
- No reference hover cards.
- No token-level reference navigation.

## Long-Term Scope

- Highlight formula references as tokens.
- Preserve token spans for hover and jump interactions.
- Support multiline formula editing.
- Support indentation and readable formatting.
- Support formula comments.
- Autocomplete functions, sheets, ranges, and eventually named columns.
- Show inline parse errors without losing the raw formula.

## Open Decisions

- Should formula comments use Excel-like syntax, a custom syntax, or a structured metadata layer?
- Should formatted formulas preserve user formatting exactly?
- Should formula editing happen directly inside the grid cell, in a formula bar, or both?
