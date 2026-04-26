# Formula Editor

## Purpose

Formula editing should support richer interaction than a plain text input. It should help users read, navigate, format, and explain formulas.

## Feature Scope

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
