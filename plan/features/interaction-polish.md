# Interaction Polish

MVP importance: Later.

## Purpose

Sheetspace should eventually feel smooth and direct. Spatial movement, sheet selection, row/column insertion, and reference visualization can make the product easier to understand, but they should not distract from the first functional implementation.

## MVP Slice

- No advanced polish is required for the MVP.
- Basic interactions should be understandable and not block editing.

## MVP Limitations

- No animated row or column insertion.
- No animated selection transitions.
- No animated back/forward travel.
- No zoom-dependent editing threshold unless needed to avoid broken interactions.
- No clickable reference lines.

## Long-Term Scope

- Show an add button after the last row or column.
- Show an insertion affordance when the pointer is near a row or column boundary.
- Preview inserted rows or columns by expanding the boundary into a greyed-out new row or column.
- Animate selection movement so it smoothly shrinks and expands to the target cell, range, or sheet.
- Expand a cell selection into a sheet selection when focus moves from a cell to a whole sheet.
- Disable detailed editing when a sheet is too small to read at the current zoom level.
- Re-enable editing when text is readable.
- Animate back/forward navigation through the 2D workspace.

## Open Decisions

- Which animations improve understanding rather than adding visual noise?
- What zoom threshold should switch sheets between overview and editing modes?
- How should reduced-motion preferences affect spatial animations?
