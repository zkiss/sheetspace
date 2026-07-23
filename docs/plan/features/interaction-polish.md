# Interaction Polish

## Purpose

Sheetspace should feel smooth and direct. Spatial movement, sheet selection, row and column insertion, and reference visualization should make the product easier to understand.

## Feature Scope

- Show an add button after the last row or column.
- Show an insertion affordance when the pointer is near a row or column boundary.
- Preview inserted rows or columns by expanding the boundary into a greyed-out new row or column.
- Animate selection changes between cells, ranges, and whole sheets with smooth shrinking and expansion to the target so focus transitions remain visually understandable.
- When focus changes from a cell or range to a whole sheet, animate the selection expanding into the sheet selection.
- Use the product of viewport scale and sheet visual scale to determine effective screen scale.
- Switch sheets to a lightweight overview presentation when their effective screen scale is too small for legible cell editing, while keeping frame selection and navigation available.
- Return to detailed editing automatically when the sheet becomes legible again.
- Keep selected-frame scaling controls usable at miniature scales by rendering them at a stable screen size.
- Animate back/forward navigation through the 2D workspace.

## Open Decisions

- Which animations improve understanding rather than adding visual noise?
- How should reduced-motion preferences affect spatial animations?
