# Sheet Frames

MVP importance: Limited.

## Purpose

A sheet frame is a movable object on the workspace that contains one tabular worksheet. It gives a sheet physical location and visual identity.

## MVP Slice

- Render each sheet inside a frame.
- Show enough identity for the user to distinguish sheets.
- Allow each frame to be placed freely in 2D space.
- Allow moving frames around the workspace.

## MVP Limitations

- No frame resizing.
- No collapse, minimize, hide, or layer controls.
- No custom frame styling.
- No jump controls in the frame header.
- No advanced z-index behavior beyond making the active sheet usable.

## Long-Term Scope

- Resize sheets from edges or corners.
- Persist frame size and position.
- Show sheet title and lightweight controls.
- Focus a frame for editing.
- Manage z-order when sheets overlap.
- Collapse, minimize, hide, or group frames.

## Open Decisions

- Should the frame title be editable inline or through a command?
- How should overlapping sheets be handled?
- Should frame resize affect visible row/column count, cell size, or both?
