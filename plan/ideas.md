- button after last column/row to add one more
- when mouse close to line between rows/cols, + button appears to insert new:
  on further hover on + button also animate result: a new row/col grows in there, the separating line expands into a new one,
  as if the new row was there already, but greyed out, indicating it doesnt exist yet.
  mouse movement shrinks the row back into a line
- when sheet is very small because zoomed out, don't allow editing. when text is readable, allow.
- selection of cells to move through space smoothly like it does in excel gradually shrinking and expanding to match target
- when selecting a sheet after a cell, still animated and the cell selection expands to be sheet selection
- back/fwd: navigate smoothly following user journey through 2d space.
  wherever user paused dragging for few seconds,
  that's a spot in the navigation history to go back to
- back/fwd: with nice animations flying through space
- when showing references: visual coloured lines which connect 
  to the referenced cells in physical space.
  lines can be clicked on to navigate to source.
- New navigation after going back should NOT clear the forward history:
  I should be go back and fwd again as many times as i like between 2 places.
- allow multiline editing formulas with indentation and formatting
- allow formula comments
- allow cell comments
- support custom functions built up of formulas
- maybe: function supporting imperative programming
- sheet/range diff support (multi select, show diff)
- allow creating 'report sheets': not tables, contain freely positioned cells and text boxes, charts and graphs, etc
- layers/groups: group sheets arbitrarily. allow show/hide
- sectors?: 2d space areas to group sheets by position
- some sort of oop way to define tables: one row = one object, object property = column, column content is the formula - simple way to ensure formulas same on each row. 