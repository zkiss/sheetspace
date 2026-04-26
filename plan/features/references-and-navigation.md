# References And Navigation

MVP importance: Deferred.

## Purpose

References should eventually become first-class entities. A user should be able to understand where a formula gets its data from without manually searching through sheets.

## MVP Slice

- The MVP only needs formula references to the extent required by the limited `SUM` formula scope.
- No navigation or inspection UI is required in the MVP.

## MVP Limitations

- No jump-to-definition.
- No jump-to-sheet.
- No hover info.
- No visual reference lines.
- No navigation history.
- No reference refactoring.

## Long-Term Scope

- Support reference forms such as `A1`, `A1:B10`, `SheetName!A1`, `SheetName!A1:B10`, and quoted sheet names.
- Preserve token spans in parsed formulas for UI interactions.
- Ctrl-click or hotkey jump from a formula reference to the target cell, range, or sheet.
- Highlight the target after navigation.
- Pan and zoom to bring offscreen targets into view.
- Show hover info for referenced cells and ranges.
- Mark broken references clearly.
- Provide visual colored lines connecting formulas to referenced cells in physical workspace space.
- Allow clicking a reference line to navigate to the source.

## Navigation History

Navigation should feel spatial and reversible.

Desired behavior:

- Keep back and forward controls for reference jumps and meaningful workspace movement.
- Record places where the user pauses in the workspace for a few seconds.
- Animate navigation through 2D space when moving back or forward.
- Preserve forward history when a user navigates after going back, so they can move repeatedly between important places.

## Open Decisions

- How should forward history work if navigation branches?
- Which user movements are important enough to record?
- Should reference lines be always visible, shown on selection, or shown on demand?
