import type { CSSProperties } from 'react';
import { clampSheetFrameSize, SHEET_HEADER_HEIGHT } from '@workspace/workspaceGeometry';
import type { CreatingSheetFrame as CreatingSheetFrameState } from '@application/core/sheetCreationState';
import './SheetFrame.css';

export function CreatingSheetFrame({ frame }: { frame: CreatingSheetFrameState }) {
  const size = clampSheetFrameSize(frame.size);
  return (
    <article
      aria-busy="true"
      aria-label={`Creating sheet ${frame.name}`}
      className="sheet-frame sheet-frame-creating"
      data-testid="creating-sheet-frame"
      style={{
        '--sheet-header-height': `${SHEET_HEADER_HEIGHT}px`,
        left: frame.position.x,
        top: frame.position.y,
        zIndex: frame.zIndex,
        width: size.width,
        height: size.height,
        transform: `scale(${frame.visualScale})`,
        transformOrigin: 'top left',
      } as CSSProperties}
    >
      <header className="sheet-frame-header"><h2>{frame.name}</h2></header>
      <div className="sheet-frame-creating-body" role="status">Creating sheet…</div>
    </article>
  );
}
