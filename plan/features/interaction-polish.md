# Interaction Polish

## Purpose

Sheetspace should feel smooth and direct. Spatial movement, sheet selection, row and column insertion, and reference visualization should make the product easier to understand.

## Feature Scope

- Show an add button after the last row or column.
- Show an insertion affordance when the pointer is near a row or column boundary.
- Preview inserted rows or columns by expanding the boundary into a greyed-out new row or column.
- Animate selection changes between cells, ranges, and whole sheets with smooth shrinking and expansion to the target so focus transitions remain visually understandable.
- Disable detailed editing when a sheet is too small to read at the current zoom level.
- Re-enable editing when text is readable.
- Animate back/forward navigation through the 2D workspace.

## Open Decisions

- Which animations improve understanding rather than adding visual noise?
- What zoom threshold should switch sheets between overview and editing modes?
- How should reduced-motion preferences affect spatial animations?
