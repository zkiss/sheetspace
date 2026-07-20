-- Cell values are now stored directly as strings, with cross-sheet IDs embedded
-- in formula text. Existing JSON uses the removed object/sidecar representation.
DELETE FROM sheets;
