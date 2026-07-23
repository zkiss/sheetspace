# Sheet Frames

## Purpose

A sheet frame is a movable object on the workspace that contains one tabular worksheet. It gives a sheet physical location and visual identity.

## Feature Scope

- Render each sheet inside a frame.
- Show enough identity for the user to distinguish sheets.
- Allow users to create new sheets.
- Allow each frame to be placed freely in 2D space.
- Allow moving frames around the workspace.
- Resize sheets from edges or corners.
- Store a persistent uniform visual scale for each sheet separately from frame size and grid dimensions.
- When a sheet is created, derive its initial visual scale from the inverse viewport scale so it appears at a usable screen size and retains its relative canvas scale after zooming out.
- Provide a distinct scale handle plus numeric percentage control; keep frame resizing and visual scaling separate.
- Persist frame size, position, and visual scale.
- Show sheet title and lightweight controls.
- Focus a frame for editing.
- Manage z-order when sheets overlap.
- Collapse, minimize, hide, or group frames.

## Spatial Composition

- Sheets are independently positioned peers in one workspace coordinate system.
- Scale, overlap, and z-order support free visual composition, including miniature sheets placed over regions of larger ones.
- Z-order determines which overlapping sheet receives interaction.
- Flat groups add shared movement commands over independently stored sheet layouts.

## Z-Order

- New sheets are stacked above older sheets.
- Users can move a sheet one level up, one level down, to the top, or to the bottom.
- Z-order changes are explicit commands. Dragging, selecting, focusing, or editing a sheet should not implicitly bring it to the front.
- Frame stacking should be deterministic and prevent controls, sticky headers, or scrollbars from visually interleaving between overlapping frames.
- Z-order should be represented in workbook state so it can be persisted with the rest of the sheet frame state.

## Open Decisions

- Should the frame title be editable inline or through a command?
- Should frame resize affect visible row/column count, cell size, or both?
