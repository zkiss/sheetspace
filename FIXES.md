# Fixes log

This file is temporary. Delete it before merging this branch into `main`.

## Fixing protocol

- Address the feedback only.
- Tests do not need to be updated or run, and they do not need to pass.
- After each fixing turn, record the fixes below and commit the changes.

## Fixes

- Focus newly added property names. Add shortcuts while editing a name: Alt+Shift+Enter adds below, Alt+Shift+Delete removes, and Alt+Shift+Up/Down moves the property.
- Use Up and Down in a property name field to focus the adjacent property name.
- Save the entire data model form with Ctrl+Enter, including from a formula editor.
- Show entry-row validation in a readable floating error attached to the selected cell. Use spreadsheet-style cell navigation and the shared light/heavy editor for entry drafts, and allow navigation between the draft and saved rows without submitting it.
- Focus the first entry cell when entering an empty model-bound sheet.
- Match entry-row selection to normal sheet cells and clear the previous sheet selection when entering the row.
- Add a Delete row command to the command palette for the row containing the selected cell.
